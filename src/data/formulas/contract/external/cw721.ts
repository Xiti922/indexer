import { ContractFormula } from '@/core'

import { Expiration } from '../../../types'

interface ContractInfo {
  name: string
  symbol: string
}

interface Approval {
  spender: string
  expires: Expiration
}

interface TokenInfo {
  owner: string
  approvals: Approval[]
  token_uri?: string
  extension: any
}

type NftInfo = Pick<TokenInfo, 'token_uri' | 'extension'>
type OwnerOfInfo = Pick<TokenInfo, 'owner' | 'approvals'>

export const minter: ContractFormula<string | undefined> = async ({
  contractAddress,
  get,
}) => await get<string>(contractAddress, 'minter')

export const contractInfo: ContractFormula<ContractInfo | undefined> = async ({
  contractAddress,
  get,
}) => await get<ContractInfo>(contractAddress, 'nft_info')

export const nftInfo: ContractFormula<
  NftInfo | undefined,
  { tokenId: string }
> = async ({ contractAddress, get, args: { tokenId } }) => {
  const info = await get<TokenInfo>(contractAddress, 'tokens', tokenId)

  return (
    info && {
      token_uri: info.token_uri,
      extension: info.extension,
    }
  )
}

export const ownerOf: ContractFormula<
  OwnerOfInfo | undefined,
  { tokenId: string }
> = async ({ contractAddress, get, args: { tokenId } }) => {
  const info = await get<TokenInfo>(contractAddress, 'tokens', tokenId)

  return (
    info && {
      owner: info.owner,
      approvals: info.approvals,
    }
  )
}

export const allNftInfo: ContractFormula<
  { access: OwnerOfInfo; info: NftInfo } | undefined,
  { tokenId: string }
> = async (env) => {
  const access = await ownerOf(env)
  const info = await nftInfo(env)

  return (
    access &&
    info && {
      access,
      info,
    }
  )
}

export const allOperators: ContractFormula<
  Approval[],
  { owner: string; limit?: string; startAfter?: string }
> = async ({ contractAddress, getMap, args: { owner, limit, startAfter } }) => {
  const limitNum = limit ? Math.max(0, Number(limit)) : Infinity

  const operatorsMap =
    (await getMap<string, Expiration>(contractAddress, ['operators', owner])) ??
    {}
  const approvals = Object.entries(operatorsMap)
    // Ascending by spender address.
    .sort(([a], [b]) => a.localeCompare(b))
    .filter(([address]) => !startAfter || address.localeCompare(startAfter) > 0)
    .slice(0, limitNum)

  return approvals.map(([spender, expires]) => ({
    spender,
    expires,
  }))
}

export const numTokens: ContractFormula<number> = async ({
  contractAddress,
  get,
}) => (await get<number>(contractAddress, 'num_tokens')) ?? 0

export const tokens: ContractFormula<
  string[],
  { owner: string; limit?: string; startAfter?: string }
> = async ({ contractAddress, getMap, args: { owner, limit, startAfter } }) => {
  const limitNum = limit ? Math.max(0, Number(limit)) : Infinity

  const tokensMap =
    (await getMap<string>(contractAddress, ['tokens__owner', owner])) ?? {}
  const tokens = Object.keys(tokensMap)
    // Ascending by token ID.
    .sort(([a], [b]) => a.localeCompare(b))
    .filter(([tokenId]) => !startAfter || tokenId.localeCompare(startAfter) > 0)
    .slice(0, limitNum)

  return tokens
}

export const allTokens: ContractFormula<
  string[],
  { limit?: string; startAfter?: string }
> = async ({ contractAddress, getMap, args: { limit, startAfter } }) => {
  const limitNum = limit ? Math.max(0, Number(limit)) : Infinity

  const tokensMap = (await getMap<string>(contractAddress, 'tokens')) ?? {}
  const tokens = Object.keys(tokensMap)
    // Ascending by token ID.
    .sort(([a], [b]) => a.localeCompare(b))
    .filter(([tokenId]) => !startAfter || tokenId.localeCompare(startAfter) > 0)
    .slice(0, limitNum)

  return tokens
}

export const approvalsForSpender: ContractFormula<
  Approval[] | undefined,
  { tokenId: string; spender: string }
> = async ({ contractAddress, get, args: { tokenId, spender } }) => {
  const info = await get<TokenInfo>(contractAddress, 'tokens', tokenId)
  if (!info) {
    return undefined
  }

  if (info.owner === spender) {
    return [
      {
        spender: info.owner,
        expires: { never: {} },
      },
    ]
  }

  const spenderApprovals = info.approvals.filter(
    (approval) => approval.spender === spender
  )

  return spenderApprovals
}

export const approvals: ContractFormula<
  Approval[] | undefined,
  { tokenId: string }
> = async ({ contractAddress, get, args: { tokenId } }) =>
  (await get<TokenInfo>(contractAddress, 'tokens', tokenId))?.approvals
