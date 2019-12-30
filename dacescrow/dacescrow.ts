// =====================================================
// WARNING: GENERATED FILE
//
// Any changes you make will be overwritten by Lamington
// =====================================================

import { Account, Contract, GetTableRowsOptions, ExtendedAsset, ExtendedSymbol, TableRowsResult } from 'lamington';

// Table row types
export interface DacescrowApprove {
	key: number;
	approver: string|number;
}

export interface DacescrowCancel {
	key: number;
}

export interface DacescrowClean {
}

export interface DacescrowDisapprove {
	key: number;
	disapprover: string|number;
}

export interface DacescrowEscrowInfo {
	key: number;
	sender: string|number;
	receiver: string|number;
	arb: string|number;
	ext_asset: ExtendedAsset;
	memo: string;
	expires: Date;
	arb_payment: number;
}

export interface DacescrowInit {
	sender: string|number;
	receiver: string|number;
	arb: string|number;
	expires: Date;
	memo: string;
	ext_reference: number;
	arb_payment: string;
}

export interface DacescrowRefund {
	key: number;
}

export interface DacescrowTransfer {
	from: string|number;
	to: string|number;
	quantity: string;
	memo: string;
}

export interface Dacescrow extends Contract {
	// Actions
	approve(key: number, approver: string|number, options?: { from?: Account, auths?: ActorPermission[] }): Promise<any>;
	cancel(key: number, options?: { from?: Account, auths?: ActorPermission[] }): Promise<any>;
	clean(options?: { from?: Account, auths?: ActorPermission[] }): Promise<any>;
	disapprove(key: number, disapprover: string|number, options?: { from?: Account, auths?: ActorPermission[] }): Promise<any>;
	init(sender: string|number, receiver: string|number, arb: string|number, expires: Date, memo: string, ext_reference: number, arb_payment: string, options?: { from?: Account, auths?: ActorPermission[] }): Promise<any>;
	refund(key: number, options?: { from?: Account, auths?: ActorPermission[] }): Promise<any>;
	transfer(from: string|number, to: string|number, quantity: string, memo: string, options?: { from?: Account, auths?: ActorPermission[] }): Promise<any>;
	
	// Tables
	escrowsTable(options?: GetTableRowsOptions): Promise<TableRowsResult<DacescrowEscrowInfo>>;
}

