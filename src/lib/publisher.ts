// @ts-ignore
import type { SuiClient } from '@mysten/sui.js/client';
// @ts-ignore
import { TransactionBlock } from "@mysten/sui.js/transactions";
// @ts-ignore
import { normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui.js/utils";

export const publishModuleTxb = (
    updatedBytecode: Uint8Array,
    dependencies: string[],
    signerAddress:string  // 签名者对象
):TransactionBlock => {
    console.log("Publishing module with dependencies:", dependencies);
    console.log("Publishing module with updatedBytecode:", updatedBytecode);
    console.log("Publishing module with signerAddress:", signerAddress);
    const txb = new TransactionBlock();
    const normalizedDependencies = dependencies.map(dep => normalizeSuiObjectId(dep));
    console.log("Normalized dependencies:", normalizedDependencies)
    const [upgradeCap] = txb.publish({
        modules: [
            [...updatedBytecode]
        ],
        dependencies: [
            normalizeSuiAddress("0x1"),
            normalizeSuiAddress("0x2"),
        ], 
    });
    txb.transferObjects([upgradeCap], txb.pure(signerAddress, "address"));
    txb.setGasBudget(100000000);
    return txb
};