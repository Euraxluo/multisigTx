import './styles.css';
import React, { useState, useEffect } from 'react';
import { useSignAndExecuteTransactionBlock, useSuiClient } from '@mysten/dapp-kit';
import { useCurrentAccount } from "@mysten/dapp-kit";
import * as Form from '@radix-ui/react-form';
import { initialBase64, constants_alias } from './Constants';
import { publishModuleTxb, CompiledModule, TemplateDynamicContent, DynamicTemplateField, ConstantReplacement } from './lib';
import { toHEX } from '@mysten/sui.js/utils';
import { TransactionBlock, UpgradePolicy } from '@mysten/sui.js/transactions';

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
    // 添加新的状态用于直接发布 Package
    const [packageJson, setPackageJson] = useState<string>("");
    const [packageMode, setPackageMode] = useState<boolean>(false);
    const [operationType, setOperationType] = useState<string>("publish"); // publish, upgrade
    const [upgradeCapId, setUpgradeCapId] = useState<string>("");
    const [packageId, setPackageId] = useState<string>("");
    const [upgradePolicy, setUpgradePolicy] = useState<string>("COMPATIBLE");
    const [policyPackageId, setPolicyPackageId] = useState<string>("");
    const [policyModule, setPolicyModule] = useState<string>("day_of_week");
    const [authFunction, setAuthFunction] = useState<string>("authorize_upgrade");
    const [commitFunction, setCommitFunction] = useState<string>("commit_upgrade");

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

    // 添加处理 JSON 输入变化的函数
    const handlePackageJsonChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setPackageJson(e.target.value);
    };

    // 添加切换模式的函数
    const toggleMode = () => {
        setPackageMode(!packageMode);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            let txb: TransactionBlock;
            
            if (packageMode) {
                // 直接从 JSON 创建发布交易
                try {
                    const packageData = JSON.parse(packageJson);
                    if (!packageData.modules || !packageData.dependencies) {
                        throw new Error("无效的 Package JSON 格式，需要包含 modules 和 dependencies");
                    }
                    
                    // 转换 modules 数组中的字符串为 Uint8Array
                    const modulesByteArrays = packageData.modules.map((mod: string) => {
                        try {
                            // 使用 fromBase64 工具函数
                            return Array.from(fromBase64(mod));
                        } catch (e) {
                            console.error("解析模块 base64 失败", e);
                            // 回退到手动解析
                            const binary = atob(mod);
                            const bytes = new Uint8Array(binary.length);
                            for (let i = 0; i < binary.length; i++) {
                                bytes[i] = binary.charCodeAt(i);
                            }
                            return Array.from(bytes);
                        }
                    });
                    
                    // 确保包含正确的发送者地址
                    const senderAddress = multisigAddress || (account?.address ?? "");
                    if (!senderAddress) {
                        throw new Error("Missing sender address");
                    }
                    
                    // 创建交易块
                    txb = new TransactionBlock();
                    
                    if (operationType === "publish") {
                        // 新发布 Package
                        const [upgradeCap] = txb.publish({
                            modules: modulesByteArrays,
                            dependencies: packageData.dependencies,
                        });
                        txb.transferObjects([upgradeCap], txb.pure(senderAddress, "address"));
                    } else if (operationType === "upgrade") {
                        // 升级 Package
                        if (!upgradeCapId) {
                            throw new Error("升级模式需要提供 UpgradeCap ID");
                        }
                        if (!packageId) {
                            throw new Error("升级模式需要提供 Package ID");
                        }
                        
                        // 使用默认升级
                        if (!policyPackageId) {
                            const upgradeCap = txb.object(upgradeCapId);
                            
                            // 创建升级交易
                            txb.upgrade({
                                modules: modulesByteArrays,
                                dependencies: packageData.dependencies,
                                packageId: packageId,
                                ticket: upgradeCap,
                            });
                        } else {
                            // 使用自定义政策模块升级
                            const cap = txb.object(upgradeCapId);
                            
                            // 确定升级策略
                            let policyValue: number;
                            switch (upgradePolicy) {
                                case "COMPATIBLE":
                                    policyValue = UpgradePolicy.COMPATIBLE;
                                    break;
                                case "ADDITIVE":
                                    policyValue = UpgradePolicy.ADDITIVE;
                                    break;
                                case "DEP_ONLY":
                                    policyValue = UpgradePolicy.DEP_ONLY;
                                    break;
                                default:
                                    policyValue = UpgradePolicy.COMPATIBLE;
                            }
                            
                            // 正确处理 digest
                            let digestArray: number[] = packageData.digest;
                            if (!Array.isArray(digestArray)) {
                                console.warn("digest 不是数组格式，将尝试其他格式");
                                digestArray = [];
                            }
                            
                            // 获取授权票据
                            const ticket = txb.moveCall({
                                target: `${policyPackageId}::${policyModule}::${authFunction}`,
                                arguments: [
                                    cap, 
                                    txb.pure(policyValue),
                                    txb.pure(digestArray)
                                ],
                            });

                            // 创建升级交易
                            const receipt = txb.upgrade({
                                modules: modulesByteArrays,
                                dependencies: packageData.dependencies,
                                packageId: packageId,
                                ticket: ticket,
                            });

                            // 提交升级
                            txb.moveCall({
                                target: `${policyPackageId}::${policyModule}::${commitFunction}`,
                                arguments: [cap, receipt],
                            });
                        }
                    }
                    
                    txb.setGasBudget(100000000);
                    txb.setGasOwner(account?.address as string);
                    txb.setSender(senderAddress);
                } catch (error) {
                    console.error("解析 Package JSON 失败:", error);
                    alert(`解析 Package JSON 失败: ${(error as Error).message}`);
                    return;
                }
            } else {
                // 使用原有的 CompiledModule 逻辑
                if (!compiledModule) return;
                const content: TemplateDynamicContent<DynamicTemplateField> = { constants, identifiers };
                console.log(content);
                compiledModule.replaceConstantsAndIdentifiers(moduleName, content);
                console.log(compiledModule.inner);
                const updatedBytecode = compiledModule.byte_code;
                
                // 确保包含正确的发送者地址
                const senderAddress = multisigAddress || (account?.address ?? "");
                if (!senderAddress) {
                    throw new Error("Missing sender address");
                }
                
                // 获取交易块对象
                txb = publishModuleTxb(updatedBytecode, compiledModule.inner.identifiers, senderAddress);
                
                txb.setGasOwner(account?.address as string);
                txb.setSender(senderAddress);
            }
            
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
                        suiClient.waitForTransactionBlock({ 
                            digest: tx.digest, 
                            options: {
                                showBalanceChanges: true,
                                showEffects: true,
                                showEvents: true,
                                showObjectChanges: true,
                                showInput: true,
                            } 
                        }).then((resp) => {
                            console.log("New Module published! Digest:", tx.digest);
                            console.log("Transaction details:", resp);
                            
                            // 安全处理可能为 undefined 的情况
                            const packageId = resp.objectChanges?.find(
                                (item) => item.type === "published"
                            )?.packageId;
                            
                            if (packageId) {
                                console.log("Package ID:", packageId);
                            }
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <h2>Move 模块发布工具</h2>
                <button 
                    type="button" 
                    onClick={toggleMode} 
                    className="Button"
                >
                    {packageMode ? "切换到模板模式" : "切换到包发布模式"}
                </button>
            </div>
            
            {packageMode ? (
                // 包发布模式的表单
                <>
                    <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                        <label>
                            <input
                                type="radio"
                                value="publish"
                                checked={operationType === "publish"}
                                onChange={(e) => setOperationType(e.target.value)}
                            />
                            发布新 Package
                        </label>
                        <label>
                            <input
                                type="radio"
                                value="upgrade"
                                checked={operationType === "upgrade"}
                                onChange={(e) => setOperationType(e.target.value)}
                            />
                            升级现有 Package
                        </label>
                    </div>
                    
                    <Form.Field className="FormField" name="packageJson">
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                            <Form.Label className="FormLabel">Package JSON</Form.Label>
                        </div>
                        <Form.Control asChild>
                            <textarea 
                                className="Textarea" 
                                value={packageJson} 
                                onChange={handlePackageJsonChange} 
                                required 
                                placeholder='{"modules":["base64编码的模块字节"],"dependencies":["0x1","0x2"],"digest":[...]}'
                                style={{ height: 200 }}
                            />
                        </Form.Control>
                    </Form.Field>
                    
                    {operationType === "upgrade" && (
                        <div style={{ border: '1px solid #ddd', padding: '15px', borderRadius: '5px', marginBottom: '15px' }}>
                            <h3>升级配置</h3>
                            
                            <Form.Field className="FormField" name="upgradeCapId">
                                <Form.Label className="FormLabel">UpgradeCap ID</Form.Label>
                                <Form.Control asChild>
                                    <input 
                                        className="Input" 
                                        type="text" 
                                        value={upgradeCapId} 
                                        onChange={(e) => setUpgradeCapId(e.target.value)} 
                                        required 
                                    />
                                </Form.Control>
                            </Form.Field>
                            
                            <Form.Field className="FormField" name="packageId">
                                <Form.Label className="FormLabel">Package ID</Form.Label>
                                <Form.Control asChild>
                                    <input 
                                        className="Input" 
                                        type="text" 
                                        value={packageId} 
                                        onChange={(e) => setPackageId(e.target.value)} 
                                        required 
                                    />
                                </Form.Control>
                            </Form.Field>
                            
                            <Form.Field className="FormField" name="upgradePolicy">
                                <Form.Label className="FormLabel">升级策略</Form.Label>
                                <Form.Control asChild>
                                    <select 
                                        className="Input" 
                                        value={upgradePolicy} 
                                        onChange={(e) => setUpgradePolicy(e.target.value)}
                                    >
                                        <option value="COMPATIBLE">COMPATIBLE</option>
                                        <option value="ADDITIVE">ADDITIVE</option>
                                        <option value="DEP_ONLY">DEP_ONLY</option>
                                    </select>
                                </Form.Control>
                            </Form.Field>
                            
                            <div style={{ marginTop: '15px', padding: '10px 0', borderTop: '1px solid #eee' }}>
                                <h4>自定义升级策略（可选）</h4>
                                
                                <Form.Field className="FormField" name="policyPackageId">
                                    <Form.Label className="FormLabel">Policy Package ID</Form.Label>
                                    <Form.Control asChild>
                                        <input 
                                            className="Input" 
                                            type="text" 
                                            value={policyPackageId} 
                                            onChange={(e) => setPolicyPackageId(e.target.value)} 
                                            placeholder="留空则使用默认升级方式"
                                        />
                                    </Form.Control>
                                </Form.Field>
                                
                                {policyPackageId && (
                                    <>
                                        <Form.Field className="FormField" name="policyModule">
                                            <Form.Label className="FormLabel">Policy Module 名称</Form.Label>
                                            <Form.Control asChild>
                                                <input 
                                                    className="Input" 
                                                    type="text" 
                                                    value={policyModule} 
                                                    onChange={(e) => setPolicyModule(e.target.value)} 
                                                />
                                            </Form.Control>
                                        </Form.Field>
                                        
                                        <Form.Field className="FormField" name="authFunction">
                                            <Form.Label className="FormLabel">授权函数名</Form.Label>
                                            <Form.Control asChild>
                                                <input 
                                                    className="Input" 
                                                    type="text" 
                                                    value={authFunction} 
                                                    onChange={(e) => setAuthFunction(e.target.value)} 
                                                />
                                            </Form.Control>
                                        </Form.Field>
                                        
                                        <Form.Field className="FormField" name="commitFunction">
                                            <Form.Label className="FormLabel">提交函数名</Form.Label>
                                            <Form.Control asChild>
                                                <input 
                                                    className="Input" 
                                                    type="text" 
                                                    value={commitFunction} 
                                                    onChange={(e) => setCommitFunction(e.target.value)} 
                                                />
                                            </Form.Control>
                                        </Form.Field>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </>
            ) : (
                // 原有的模板模式表单
                <>
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
                </>
            )}
            
            {/* 多签地址输入区域 - 两种模式都需要 */}
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
function fromBase64(mod: string): Iterable<unknown> | ArrayLike<unknown> {
    throw new Error('Function not implemented.');
}

