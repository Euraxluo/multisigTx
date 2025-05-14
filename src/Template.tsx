import './styles.css';
import React, { useState, useEffect } from 'react';
import { useSignAndExecuteTransactionBlock, useSuiClient } from '@mysten/dapp-kit';
import { useCurrentAccount } from "@mysten/dapp-kit";
import * as Form from '@radix-ui/react-form';
import { initialBase64, constants_alias } from './Constants';
import { publishModuleTxb, CompiledModule, TemplateDynamicContent, DynamicTemplateField, ConstantReplacement } from './lib';
import { toHEX } from '@mysten/sui.js/utils';
import { TransactionBlock } from '@mysten/sui.js/transactions';

export function TemplateEditor() {
    const suiClient = useSuiClient();
    const { mutate: signAndExecute } = useSignAndExecuteTransactionBlock();
    const account = useCurrentAccount();

    const [base64, setBase64] = useState(initialBase64);
    const [compiledModule, setCompiledModule] = useState<CompiledModule | null>(null);
    const [constants, setConstants] = useState<ConstantReplacement<DynamicTemplateField>[]>([]);
    const [identifiers, setIdentifiers] = useState<Record<string, string>>({});
    const [moduleName, setModuleName] = useState("template");
    
    // 新增状态
    const [multisigAddress, setMultisigAddress] = useState("0x7766ccb15b4aacc5e1ff6e3bcee9485bd4cd846250999c6c6b5e2420259530c0");
    const [txData, setTxData] = useState<string | null>(null);

    useEffect(() => {
        if (compiledModule) {
            const newConstants = constants.map(constant => {
                let newValue = constant.newValue;
                return { ...constant, newValue };
            });
            setConstants(newConstants);
        }
    }, [compiledModule, moduleName]);

    const handleBase64Change = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setBase64(e.target.value);
    };

    const handleConstantChange = (index: number, field: string, value: string) => {
        const newConstants = [...constants];
        newConstants[index] = { ...newConstants[index], [field]: value };
        setConstants(newConstants);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!compiledModule) return;
        try {
            const content: TemplateDynamicContent<DynamicTemplateField> = { constants, identifiers };
            console.log(content);
            compiledModule.replaceConstantsAndIdentifiers(moduleName, content);
            console.log(compiledModule.inner)
            const updatedBytecode = compiledModule.byte_code;
            
            // 确保包含正确的发送者地址 - 使用多签地址或账户地址
            const senderAddress = multisigAddress || (account?.address ?? "");
            if (!senderAddress) {
                throw new Error("Missing sender address");
            }
            
            // 获取交易块对象
            const txb = publishModuleTxb(updatedBytecode, compiledModule.inner.identifiers, senderAddress);
            
            txb.setGasOwner(account?.address as string);
            txb.setSender(senderAddress);
            
            // 获取序列化后的字节
            const serializedTx = await txb.build({
                client: suiClient,
            });
            
            // 转换为十六进制显示
            const txHex = toHEX(serializedTx);
            console.group("序列化交易");
            console.log("交易十六进制:", txHex);
            console.groupEnd();
            
            // 设置交易数据到状态
            setTxData(txHex);
            
            // 显示交易预备完成信息
            alert("交易准备完成，可以查看交易数据或进行签名执行。");
            
        } catch (error) {
            console.error("Error preparing transaction:", error);
            alert("准备交易失败");
        }
    };

    const compileBase64 = () => {
        try {
            const module = new CompiledModule("template", base64);
            setCompiledModule(module);
            const newConstants = module.getReplaceableConstants().map(field => {
                const alias = constants_alias.find(c => c.name === field.name)?.alias || "";
                return {
                    name: field.name,
                    alias: alias,
                    newValue: field.currentValue,
                    expectedValue: field.currentValue,
                    expectedType: field.expectedType
                };
            });
            setConstants(newConstants);
            setIdentifiers(module.inner.identifiers.reduce((acc, id) => {
                acc[id] = id;
                return acc;
            }, {} as Record<string, string>));
        } catch (error) {
            console.error("Error deserializing module:", error);
            setCompiledModule(null);
        }
    };

    const handleModuleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setModuleName(e.target.value);
    };

    // 添加执行交易的方法
    const executeTransaction = () => {
        if (!txData) {
            alert("请先准备交易");
            return;
        }
        
        try {
            // 获取交易块对象
            const txb = TransactionBlock.from(txData);
            
            // 执行签名和提交
            signAndExecute(
                {
                    transactionBlock: txb,
                },
                {
                    onSuccess: (tx) => {
                        suiClient.waitForTransactionBlock({ digest: tx.digest, options:{
                            showBalanceChanges: true,
                            showEffects: true,
                            showEvents: true,
                            showObjectChanges: true,
                            showInput: true,
                        } }).then((resp) => {
                            console.log("New Wrapper Token published! Digest:", tx.digest);
                            console.log("New Wrapper Token published! TX:", resp);
                            const packageId = resp.objectChanges?.find(
                                (item) => item.type === "published"
                            )?.packageId;
                            console.log("Package ID:", packageId);
                        });
                    },
                    onError: (e) => {
                        alert("Sign Tx Failed!\nPlease Check Network And Wrapper Need Tokenized Object");
                        console.log(e);
                    }
                },
            );
            alert("Publisher Tx Successful! Please Sign And Waiting For Tx Confirmed.");
        } catch (error) {
            console.error("Error during publishing:", error);
            alert("Publisher Tx Failed");
        }
    };

    return (
        <Form.Root className="FormRoot" onSubmit={handleSubmit}>
            <Form.Field className="FormField" name="base64">
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <Form.Label className="FormLabel">Base64</Form.Label>
                </div>
                <Form.Control asChild>
                    <textarea className="Textarea" value={base64} onChange={handleBase64Change} required />
                </Form.Control>
            </Form.Field>
            <button type="button" onClick={compileBase64} className="Button" style={{ marginTop: 10 }}>
                Compile
            </button>
            <Form.Field className="FormField" name="moduleName">
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <Form.Label className="FormLabel">Module Name</Form.Label>
                </div>
                <Form.Control asChild>
                    <input 
                        className="Input" 
                        type="text" 
                        value={moduleName} 
                        onChange={handleModuleNameChange} 
                        required 
                    />
                </Form.Control>
            </Form.Field>
            
            {/* 多签地址输入区域 */}
            <Form.Field className="FormField" name="multisigAddress">
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <Form.Label className="FormLabel">Sender(if multisig,must set multisig address)</Form.Label>
                </div>
                <Form.Control asChild>
                    <input 
                        className="Input" 
                        type="text" 
                        value={multisigAddress} 
                        onChange={(e) => setMultisigAddress(e.target.value)} 
                    />
                </Form.Control>
            </Form.Field>
            
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div style={{ width: '45%', maxHeight: 400, overflowY: 'scroll', border: '1px solid #ccc', padding: 10 }}>
                    <pre>{compiledModule ? JSON.stringify(compiledModule.inner, null, 2) : "Invalid Base64"}</pre>
                </div>
                <div style={{ width: '45%' }}>
                    <h2>Constants</h2>
                    {constants
                        .filter(constant => constants_alias.some(c => c.alias === constant.alias))
                        .map((constant, index) => (
                            <Form.Field key={index} className="FormField ConstantField" name={`constant_${index}`}>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <Form.Label className="FormLabel">{constant.alias}</Form.Label>
                                    <span className="FormType" style={{ marginLeft: 10 }}>{constant.expectedType}</span>
                                    <Form.Control asChild>
                                        <input
                                            className="Input"
                                            type="text"
                                            value={constant.newValue}
                                            onChange={(e) => handleConstantChange(index, 'newValue', e.target.value)}
                                            placeholder={constant.expectedValue}
                                            style={{ marginLeft: 10 }}
                                        />
                                    </Form.Control>
                                </div>
                            </Form.Field>
                        ))}
                </div>
            </div>
            
            {/* 交易数据展示区域 */}
            {txData && (
                <div style={{ marginTop: 10, border: '1px solid #ccc', padding: 10, borderRadius: 4 }}>
                    <h3>交易数据 (十六进制)</h3>
                    <textarea
                        className="Textarea"
                        value={txData}
                        readOnly
                        style={{ height: 100, width: '100%', fontFamily: 'monospace' }}
                    />
                </div>
            )}
            
            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <Form.Submit asChild>
                    <button className="Button">
                        准备交易
                    </button>
                </Form.Submit>
                
                {txData && (
                    <button 
                        type="button" 
                        className="Button" 
                        onClick={executeTransaction}
                    >
                        签名并执行
                    </button>
                )}
            </div>
        </Form.Root>
    );
};
