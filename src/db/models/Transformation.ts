import { Op, Sequelize, WhereOptions } from 'sequelize'
import {
  AllowNull,
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript'

import {
  Block,
  ParsedEvent,
  SplitDependentKeys,
  Transformer,
  TransformerMap,
  getDependentKey,
  loadConfig,
} from '@/core'
import * as transformerMap from '@/data/transformers'

import { Contract } from './Contract'

@Table({
  timestamps: true,
  indexes: [
    // Transformers are deterministic and names must be unique so they can be
    // found, so only one output can exist for a name on a contract at a given
    // block height.
    {
      unique: true,
      fields: ['contractAddress', 'name', 'blockHeight'],
    },
    {
      // Speeds up queries. Use trigram index for string name to speed up
      // partial matches (LIKE).
      fields: [Sequelize.literal('name gin_trgm_ops'), 'blockHeight'],
      concurrently: true,
      using: 'gin',
    },
    {
      // Speeds up queries.
      fields: ['value'],
      concurrently: true,
      using: 'gin',
    },
  ],
})
export class Transformation extends Model {
  @AllowNull(false)
  @ForeignKey(() => Contract)
  @Column
  contractAddress!: string

  @BelongsTo(() => Contract)
  contract!: Contract

  @AllowNull(false)
  @Column(DataType.BIGINT)
  blockHeight!: number

  @AllowNull(false)
  @Column(DataType.BIGINT)
  blockTimeUnixMs!: number

  @AllowNull(false)
  @Column(DataType.TEXT)
  name!: string

  @AllowNull
  @Column(DataType.JSONB)
  value!: unknown | null

  get block(): Block {
    return {
      height: this.blockHeight,
      timeUnixMs: this.blockTimeUnixMs,
    }
  }

  get dependentKey(): string {
    return getDependentKey(this.contractAddress, this.name)
  }

  // Split dependent keys into two groups: non map keys and map prefixes. Map
  // prefixes end with a colon because they are missing the final key segment,
  // which is the key of each map entry.
  static splitDependentKeys(dependentKeys: string[]): SplitDependentKeys {
    return {
      nonMapKeys: dependentKeys.filter((key) => key[key.length - 1] !== ':'),
      mapPrefixes: dependentKeys.filter((key) => key[key.length - 1] === ':'),
    }
  }

  // Returns a where clause that will match all transformations that are
  // described by the dependent keys, which contain various contract addresses
  // and names.
  static getWhereClauseForDependentKeys(dependentKeys: string[]): WhereOptions {
    // Some keys (most likely those with wildcards) may not have a contract
    // address. It is fine to group these together.
    const dependentNamesByContract = dependentKeys.reduce(
      (acc, dependentKey) => {
        // Dependent keys for any contract start with "%:".
        const [contractAddress, name] = dependentKey.startsWith('%:')
          ? ['', dependentKey]
          : dependentKey.split(':')
        return {
          ...acc,
          [contractAddress]: [...(acc[contractAddress] ?? []), name],
        }
      },
      {} as Record<string, string[] | undefined>
    )

    return {
      [Op.or]: Object.entries(dependentNamesByContract).map(
        ([contractAddress, dependentKeys]) => {
          const { nonMapKeys, mapPrefixes } = Transformation.splitDependentKeys(
            dependentKeys!
          )

          const exactNames = nonMapKeys.filter((name) => !name.includes('%'))
          const wildcardNames = nonMapKeys.filter((name) => name.includes('%'))

          return {
            // Only include if contract address is defined.
            ...(contractAddress && { contractAddress }),
            // Same logic as in `updateComputationValidityDependentOnChanges` in
            // `src/db/utils.ts`.
            name: {
              [Op.or]: [
                // Where name is one of the non-map names.
                ...(exactNames.length > 0 ? [{ [Op.in]: exactNames }] : []),
                ...wildcardNames.map((name) => ({
                  [Op.like]: name,
                })),
                // Or where key is prefixed by one of the map prefixes.
                ...mapPrefixes.map((prefix) => ({
                  [Op.like]: prefix + '%',
                })),
              ],
            },
          }
        }
      ),
    }
  }

  static async transformEvents(
    events: ParsedEvent[]
  ): Promise<Transformation[]> {
    const { codeIds } = loadConfig()

    const transformers = Object.values(transformerMap as TransformerMap)
    // Collect each transformer's total set of code IDs to use for filtering by
    // matching keys with the config.
    const transformerCodeIds = transformers.map(({ codeIdsKeys }) =>
      codeIdsKeys.length
        ? codeIdsKeys.flatMap((key) => codeIds?.[key] ?? [])
        : // Those with no code IDs are always included.
          null
    )

    // Collect all pending transformations before evaluating them. This is
    // because some transformations may depend on the value of previous
    // transformations, which may exist in this current set of uncommitted
    // transformations. Thus, we need to evaluate them sequentially.
    const unevaluatedTransformations: {
      event: ParsedEvent
      transformer: Transformer
      pendingTransformation: PendingTransformation
    }[] = events.flatMap((event) => {
      const transformersForEvent = transformers.filter(
        (transformer, index) =>
          // Those with no code IDs are always included.
          (transformerCodeIds[index] === null ||
            transformerCodeIds[index]!.includes(event.codeId)) &&
          transformer.matches(event)
      )

      return transformersForEvent.map((transformer) => ({
        event,
        transformer,
        pendingTransformation: {
          contractAddress: event.contractAddress,
          blockHeight: event.blockHeight,
          blockTimeUnixMs: event.blockTimeUnixMs,
          name:
            typeof transformer.name === 'string'
              ? transformer.name
              : transformer.name(event),
          value: undefined,
        },
      }))
    })

    const evaluatedTransformations: PendingTransformation[] = []

    // Evaluate all pending transformations sequentially.
    for (const {
      event,
      transformer,
      pendingTransformation,
    } of unevaluatedTransformations) {
      pendingTransformation.value =
        (await transformer.getValue(event, async () => {
          // Find most recent transformation for this contract and name before
          // this block.

          // Check evaluated transformations in case the most recent
          // transformation is in the current group of events.
          const evaluatedTransformation = evaluatedTransformations
            .filter(
              (transformation) =>
                transformation.contractAddress ===
                  pendingTransformation.contractAddress &&
                transformation.name === pendingTransformation.name
            )
            .slice(-1)[0]

          if (evaluatedTransformation) {
            return evaluatedTransformation.value
          }

          // Fallback to database.
          return (
            (
              await Transformation.findOne({
                where: {
                  contractAddress: event.contractAddress,
                  name: pendingTransformation.name,
                  blockHeight: {
                    [Op.lt]: event.blockHeight,
                  },
                },
                order: [['blockHeight', 'DESC']],
              })
            )?.value ?? null
          )
        })) ?? null

      // Update the latest transformation for the same contract, name, and block
      // height if it exists. We want this newer transformation to be able to
      // access the previous value during its evaluation, in case the
      // transformation is iterating on values, such as a counter, but only one
      // transformation can exist for a contract, name, and block height set.
      const latestTransformation = evaluatedTransformations
        .filter(
          (transformation) =>
            transformation.contractAddress ===
              pendingTransformation.contractAddress &&
            transformation.name === pendingTransformation.name &&
            transformation.blockHeight === pendingTransformation.blockHeight
        )
        .slice(-1)[0]

      if (latestTransformation) {
        latestTransformation.value = pendingTransformation.value
      } else {
        evaluatedTransformations.push(pendingTransformation)
      }
    }

    // Save all pending transformations.
    return await Transformation.bulkCreate(evaluatedTransformations, {
      updateOnDuplicate: ['value', 'delete'],
    })
  }
}

type PendingTransformation = {
  contractAddress: string
  blockHeight: number
  blockTimeUnixMs: number
  name: string
  value: any | null
}
