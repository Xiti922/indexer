import { ContractFormula, NestedFormulaMap, WalletFormula } from '@/core'

import { contractFormulas, walletFormulas } from './formulas'

export const getContractFormula = (
  formulaName: string
): ContractFormula<any, any> | undefined => {
  const formulaPath = formulaName.split('/')
  const formulaBase = formulaPath
    .slice(0, -1)
    .reduce(
      (acc, key) =>
        typeof acc === 'object' && acc[key] ? acc[key] : undefined,
      contractFormulas as
        | NestedFormulaMap<ContractFormula<any, any>>
        | ContractFormula<any, any>
        | undefined
    )

  const formula =
    typeof formulaBase === 'object'
      ? formulaBase[formulaPath[formulaPath.length - 1]]
      : undefined
  return typeof formula === 'function' ? formula : undefined
}

export const getWalletFormula = (
  formulaName: string
): WalletFormula<any, any> | undefined => {
  const formulaPath = formulaName.split('/')
  const formulaBase = formulaPath
    .slice(0, -1)
    .reduce(
      (acc, key) =>
        typeof acc === 'object' && acc[key] ? acc[key] : undefined,
      walletFormulas as
        | NestedFormulaMap<WalletFormula<any, any>>
        | WalletFormula<any, any>
        | undefined
    )

  const formula =
    typeof formulaBase === 'object'
      ? formulaBase[formulaPath[formulaPath.length - 1]]
      : undefined
  return typeof formula === 'function' ? formula : undefined
}

type TypedFormula =
  | {
      type: 'contract'
      formula: ContractFormula<any, any>
    }
  | {
      type: 'wallet'
      formula: WalletFormula<any, any>
    }

export const getTypedFormula = (
  type: 'contract' | 'wallet',
  formulaName: string
): TypedFormula => {
  const typeAndFormula =
    type === 'contract'
      ? {
          type,
          formula: getContractFormula(formulaName),
        }
      : {
          type,
          formula: getWalletFormula(formulaName),
        }

  if (!typeAndFormula.formula) {
    throw new Error(`Formula not found: ${formulaName}`)
  }

  return typeAndFormula as TypedFormula
}
