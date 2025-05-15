import './styles.css';
import React, { useState } from 'react';
import { useSignAndExecuteTransactionBlock, useSuiClient } from '@mysten/dapp-kit';
import { useCurrentAccount } from "@mysten/dapp-kit";
import * as Form from '@radix-ui/react-form';
import { constants_alias } from './Constants';
import { CompiledModule, TemplateDynamicContent, DynamicTemplateField, ConstantReplacement } from './lib';
import { toHEX } from '@mysten/sui.js/utils';
import { TransactionBlock, UpgradePolicy } from '@mysten/sui.js/transactions';

// 添加缺失的 fromBase64 函数
function fromBase64(base64String: string): Uint8Array {
    try {
        // 在浏览器环境
        const binary = atob(base64String);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    } catch (error) {
        console.error("解析 base64 失败", error);
        throw error;
    }
}

export function TemplateEditor() {
    const suiClient = useSuiClient();
    const { mutate: signAndExecute } = useSignAndExecuteTransactionBlock();
    const account = useCurrentAccount();

    // 新增状态
    const [multisigAddress, setMultisigAddress] = useState("0x7766ccb15b4aacc5e1ff6e3bcee9485bd4cd846250999c6c6b5e2420259530c0");
    const [txData, setTxData] = useState<string | null>(null);
    const [txToSign, setTxToSign] = useState<TransactionBlock | null>(null);
    
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
    
    // 新增多模块支持
    const [modules, setModules] = useState<{
        moduleBase64: string;
        compiledModule: CompiledModule | null;
        moduleName: string;
        constants: ConstantReplacement<DynamicTemplateField>[];
        identifiers: Record<string, string>;
        expanded: boolean;
    }[]>([]);
    const [packageData, setPackageData] = useState<any>(null);

    // 添加处理 JSON 输入变化的函数
    const handlePackageJsonChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setPackageJson(e.target.value);
        try {
            const data = JSON.parse(e.target.value);
            setPackageData(data);
            
            // 如果在模板模式下，从JSON解析modules
            if (!packageMode && data && Array.isArray(data.modules)) {
                const newModules = data.modules.map((moduleBase64: string, index: number) => {
                    try {
                        const compiledMod = new CompiledModule(`module_${index}`, moduleBase64);
                        const moduleConstants = compiledMod.getReplaceableConstants().map(field => {
                            const alias = constants_alias.find(c => c.name === field.name)?.alias || "";
                            return {
                                name: field.name,
                                alias: alias,
                                newValue: field.currentValue,
                                expectedValue: field.currentValue,
                                expectedType: field.expectedType
                            };
                        });
                        
                        const moduleIdentifiers = compiledMod.inner.identifiers.reduce((acc, id) => {
                            acc[id] = id;
                            return acc;
                        }, {} as Record<string, string>);
                        
                        return {
                            moduleBase64: moduleBase64,
                            compiledModule: compiledMod,
                            moduleName: `module_${index}`,
                            constants: moduleConstants,
                            identifiers: moduleIdentifiers,
                            expanded: false
                        };
                    } catch (error) {
                        console.error(`解析模块 ${index} 失败:`, error);
                        return {
                            moduleBase64: moduleBase64,
                            compiledModule: null,
                            moduleName: `module_${index}`,
                            constants: [],
                            identifiers: {},
                            expanded: false
                        };
                    }
                });
                setModules(newModules);
            }
        } catch (error) {
            console.error("解析 JSON 失败:", error);
        }
    };

    // 添加切换模式的函数
    const toggleMode = () => {
        setPackageMode(!packageMode);
    };
    
    // 添加模块展开/折叠功能
    const toggleModuleExpanded = (index: number) => {
        const newModules = [...modules];
        newModules[index].expanded = !newModules[index].expanded;
        setModules(newModules);
    };
    
    // 修改模块名称
    const handleModuleNameChange = (index: number, newName: string) => {
        const newModules = [...modules];
        newModules[index].moduleName = newName;
        setModules(newModules);
    };
    
    // 修改常量值
    const handleModuleConstantChange = (moduleIndex: number, constantIndex: number, field: string, value: string) => {
        const newModules = [...modules];
        newModules[moduleIndex].constants[constantIndex] = {
            ...newModules[moduleIndex].constants[constantIndex],
            [field]: value
        };
        setModules(newModules);
    };
    
    // 编译所有模块
    const compileAllModules = () => {
        try {
            const newModules = modules.map(module => {
                if (module.compiledModule) {
                    const content: TemplateDynamicContent<DynamicTemplateField> = {
                        constants: module.constants,
                        identifiers: module.identifiers
                    };
                    module.compiledModule.replaceConstantsAndIdentifiers(module.moduleName, content);
                    
                    // 确保强制展开，以显示编译结果
                    return { ...module, expanded: true };
                }
                return module;
            });
            setModules(newModules);
            
            // 添加编译成功的反馈
            alert("编译完成！所有模块已更新。");
        } catch (error) {
            console.error("编译模块时出错:", error);
            alert(`编译失败: ${(error as Error).message}`);
        }
    };

    // 编译单个模块
    const compileSingleModule = (index: number) => {
        try {
            const newModules = [...modules];
            const module = newModules[index];
            
            if (module.compiledModule) {
                const content: TemplateDynamicContent<DynamicTemplateField> = {
                    constants: module.constants,
                    identifiers: module.identifiers
                };
                module.compiledModule.replaceConstantsAndIdentifiers(module.moduleName, content);
                
                // 更新单个模块
                newModules[index] = { ...module };
                setModules(newModules);
                
                // 添加编译成功的反馈
                alert(`模块 ${module.moduleName} 编译成功！`);
            }
        } catch (error) {
            console.error("编译单个模块时出错:", error);
            alert(`编译失败: ${(error as Error).message}`);
        }
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
                            
                            // 正确处理 digest - 转换为 Uint8Array 后传入
                            let digestArray = packageData.digest;
                            if (!Array.isArray(digestArray)) {
                                console.warn("digest 不是数组格式，将尝试其他格式");
                                digestArray = [];
                            }
                            
                            // 获取升级票据 - 直接使用 pure 方法，不需要额外构造参数
                            const ticket = txb.moveCall({
                                target: '0x2::package::authorize_upgrade',
                                arguments: [
                                    cap,
                                    txb.pure.u8(policyValue),
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
                                target: '0x2::package::commit_upgrade',
                                arguments: [cap, receipt],
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
                            
                            // 正确处理 digest - 转换为 Uint8Array 后传入
                            let digestArray = packageData.digest;
                            if (!Array.isArray(digestArray)) {
                                console.warn("digest 不是数组格式，将尝试其他格式");
                                digestArray = [];
                            }
                            
                            // 获取授权票据 - 使用与原生方式一致的参数顺序和类型
                            const ticket = txb.moveCall({
                                target: `${policyPackageId}::${policyModule}::${authFunction}`,
                                arguments: [
                                    cap, 
                                    txb.pure.u8(policyValue),
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
                // 使用模板模式 - 处理多模块
                // 首先执行编译
                compileAllModules();
                
                // 确保有有效的包数据
                if (!packageData || !packageData.modules || !packageData.dependencies) {
                    alert("请提供有效的包数据，包含 modules 和 dependencies");
                    return;
                }
                
                // 从编译后的模块获取更新后的字节码
                const modulesByteArrays = modules.map(module => {
                    if (module.compiledModule) {
                        return Array.from(module.compiledModule.byte_code);
                    } else {
                        // 如果模块未编译成功，使用原始 base64
                        try {
                            return Array.from(fromBase64(module.moduleBase64));
                        } catch (e) {
                            console.error("解析模块 base64 失败", e);
                            const binary = atob(module.moduleBase64);
                            const bytes = new Uint8Array(binary.length);
                            for (let i = 0; i < binary.length; i++) {
                                bytes[i] = binary.charCodeAt(i);
                            }
                            return Array.from(bytes);
                        }
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
                    
                    // 正确处理 digest - 转换为 Uint8Array 后传入
                    let digestArray = packageData.digest;
                    if (!Array.isArray(digestArray)) {
                        console.warn("digest 不是数组格式，将尝试其他格式");
                        digestArray = [];
                    }
                    
                    // 获取授权票据 - 使用与原生方式一致的参数顺序和类型
                    const ticket = txb.moveCall({
                        target: `${policyPackageId}::${policyModule}::${authFunction}`,
                        arguments: [
                            cap, 
                            txb.pure.u8(policyValue),
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
                
                txb.setGasBudget(100000000);
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
            setTxToSign(txb);
            
            // 显示交易预备完成信息
            alert("交易准备完成，可以查看交易数据或进行签名执行。");
            
        } catch (error) {
            console.error("Error preparing transaction:", error);
            alert("准备交易失败");
        }
    };

    // 添加执行交易的方法
    const executeTransaction = () => {
        if (!txToSign) {
            alert("请先准备交易");
            return;
        }
        
        try {
            // 获取交易块对象
            const txb = txToSign;
            
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
            
            {/* 添加提示信息 */}
            <div style={{ 
                backgroundColor: '#f8f9fa', 
                padding: '10px', 
                borderRadius: '5px', 
                marginBottom: '15px',
                border: '1px solid #e9ecef'
            }}>
                <p style={{ margin: 0, fontSize: '14px', color: '#495057' }}>
                    📝 提示：使用以下命令生成 Package JSON：
                    <code style={{ 
                        display: 'block', 
                        backgroundColor: '#e9ecef', 
                        padding: '8px', 
                        marginTop: '5px',
                        borderRadius: '4px',
                        fontFamily: 'monospace'
                    }}>
                        sui move build --skip-fetch-latest-git-deps --dump-bytecode-as-base64 --ignore-chain
                    </code>
                </p>
            </div>
            
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
            
            {!packageMode && packageData && (
                <div style={{ marginTop: '15px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3>模块编辑</h3>
                        <button 
                            type="button" 
                            onClick={compileAllModules} 
                            className="Button"
                        >
                            编译所有模块
                        </button>
                    </div>
                    
                    {modules.map((module, moduleIndex) => (
                        <div 
                            key={moduleIndex} 
                            style={{ 
                                border: '1px solid #ddd', 
                                borderRadius: '5px', 
                                marginBottom: '10px', 
                                overflow: 'hidden' 
                            }}
                        >
                            <div 
                                style={{
                                    padding: '10px',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <span 
                                        style={{ fontWeight: 'bold', cursor: 'pointer' }}
                                        onClick={() => toggleModuleExpanded(moduleIndex)}
                                    >
                                        模块 {moduleIndex+1} {module.expanded ? '▼' : '▶'}
                                    </span>
                                    <input 
                                        type="text" 
                                        value={module.moduleName} 
                                        onChange={(e) => handleModuleNameChange(moduleIndex, e.target.value)}
                                        style={{ width: '150px' }}
                                    />
                                </div>
                                <button 
                                    type="button" 
                                    onClick={() => compileSingleModule(moduleIndex)} 
                                    className="Button"
                                    style={{ fontSize: '0.8rem', padding: '4px 8px' }}
                                >
                                    编译此模块
                                </button>
                            </div>
                            
                            {module.expanded && (
                                <div style={{ display: 'flex' }}>
                                    {/* 左侧：常量编辑区域 */}
                                    <div style={{ width: '50%', padding: '15px', borderRight: '1px solid #eee' }}>
                                        <h4>模块常量</h4>
                                        {module.compiledModule ? (
                                            module.constants
                                                .filter(constant => constants_alias.some(c => c.alias === constant.alias))
                                                .length > 0 ? (
                                                    module.constants
                                                        .filter(constant => constants_alias.some(c => c.alias === constant.alias))
                                                        .map((constant, constantIndex) => (
                                                            <Form.Field key={constantIndex} className="FormField ConstantField" name={`module_${moduleIndex}_constant_${constantIndex}`}>
                                                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                                                                    <Form.Label className="FormLabel" style={{ width: '150px' }}>{constant.alias}</Form.Label>
                                                                    <span className="FormType" style={{ width: '80px' }}>{constant.expectedType}</span>
                                                                    <Form.Control asChild>
                                                                        <input
                                                                            className="Input"
                                                                            type="text"
                                                                            value={constant.newValue}
                                                                            onChange={(e) => handleModuleConstantChange(moduleIndex, constantIndex, 'newValue', e.target.value)}
                                                                            placeholder={constant.expectedValue}
                                                                            style={{ flex: 1 }}
                                                                        />
                                                                    </Form.Control>
                                                                </div>
                                                            </Form.Field>
                                                        ))
                                                ) : (
                                                    <p>此模块没有可编辑的常量</p>
                                                )
                                        ) : (
                                            <div>
                                                <p style={{ color: 'red' }}>模块解析失败，无法编辑</p>
                                            </div>
                                        )}
                                    </div>
                                    
                                    {/* 右侧：编译JSON结果 */}
                                    <div style={{ width: '50%', padding: '15px'}}>
                                        <h4>编译结果</h4>
                                        <div style={{ 
                                            maxHeight: '300px', 
                                            overflowY: 'auto', 
                                            padding: '8px',
                                            backgroundColor: '#2d2d2d',
                                            color: '#e6e6e6',
                                            borderRadius: '4px',
                                            fontFamily: 'monospace',
                                            fontSize: '12px',
                                            whiteSpace: 'pre-wrap',
                                            wordBreak: 'break-all'
                                        }}>
                                            {module.compiledModule ? 
                                                JSON.stringify(module.compiledModule.inner, null, 2) : 
                                                "{ 模块未编译 }"}
                                        </div>
                                        
                                        {module.compiledModule && (
                                            <div style={{ marginTop: '10px' }}>
                                                <h5>模块名称</h5>
                                                <div style={{ 
                                                    padding: '4px 8px', 
                                                    backgroundColor: '#2d2d2d', 
                                                    color: '#e6e6e6',
                                                    borderRadius: '4px',
                                                    fontFamily: 'monospace'
                                                }}>
                                                    {module.moduleName}
                                                </div>
                                                
                                                <h5 style={{ marginTop: '10px' }}>字节码长度</h5>
                                                <div style={{ 
                                                    padding: '4px 8px', 
                                                    backgroundColor: '#2d2d2d', 
                                                    color: '#e6e6e6',
                                                    borderRadius: '4px',
                                                    fontFamily: 'monospace'
                                                }}>
                                                    {module.compiledModule.byte_code ? module.compiledModule.byte_code.length : 0} 字节
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
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
