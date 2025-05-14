// @ts-ignore
import init, * as template from "@mysten/move-bytecode-template";

// @ts-ignore
import url from '@mysten/move-bytecode-template/move_bytecode_template_bg.wasm?url';
import { base64ToHexClient, bcs, hexToStringClient } from "./bcs-utils";

(async () => {
    await init(url);
    console.log("WASM module initialized.");
})();

/**
 * Serialize the compiled module to bytecode.
 */
export { template };

/**
 * Deserialize the compiled module from the bytecode.
 */
export function deserializeModule(bytecode: Uint8Array): MoveCompiledModule{
    return template.deserialize(bytecode);
}


export type DynamicTemplateField = {
    name: string;
    expectedType: string;
    currentValue: string;
};

export type ConstantReplacement<T extends DynamicTemplateField> = {
    name: T['name']; // constant name, e.g., "constant_0"
    alias: string; // constant alias, e.g., "totalSupply"
    newValue: string; // new value to replace with
    expectedValue: T['currentValue']; // expected current value for validation
    expectedType: T['expectedType']; // expected type for validation
};

export type TemplateDynamicContent<T extends DynamicTemplateField> = {
    constants: ConstantReplacement<T>[];
    identifiers: Record<string, string>;
};



const resolveType = (type_: any): string => {
    if (typeof type_ === 'string') {
        return type_.toLowerCase();
    }
    if (type_.Vector) {
        return `vector:${type_.Vector.toLowerCase()}`;
    }
    throw new Error(`Unsupported constant type: ${JSON.stringify(type_)}`);
};

const decodeValue = (type: string, data: number[]): string => {
    const bytes = new Uint8Array(data);
    if (type === 'u8') {
        return bytes[0].toString();
    }
    if (type === 'u16') {
        return bcs.de('u16', bytes).toString();
    }
    if (type === 'u32') {
        return bcs.de('u32', bytes).toString();
    }
    if (type === 'u64') {
        return bcs.de('u64', bytes).toString();
    }
    if (type === 'u128') {
        return bcs.de('u128', bytes).toString();
    }
    if (type === 'u256') {
        return bcs.de('u256', bytes).toString();
    }
    if (type === 'string' || type.startsWith('vector:')) {
        return bcs.de('string', bytes);
    }
    if (type === 'bool') {
        return bcs.de('bool', bytes).toString();
    }
    if (type === 'address') {
        return bcs.de('address', bytes);
    }
    throw new Error(`Unsupported type for decoding: ${type}`);
};


const encodeValue = (type: string, value: string): number[] => {
    if (type === 'u8') {
        return [parseInt(value, 10)];
    }
    if (type === 'u16') {
        return Array.from(bcs.ser('u16', parseInt(value, 10)).toBytes());
    }
    if (type === 'u32') {
        return Array.from(bcs.ser('u32', parseInt(value, 10)).toBytes());
    }
    if (type === 'u64') {
        return Array.from(bcs.ser('u64', BigInt(value)).toBytes());
    }
    if (type === 'u128') {
        return Array.from(bcs.ser('u128', BigInt(value)).toBytes());
    }
    if (type === 'u256') {
        return Array.from(bcs.ser('u256', BigInt(value)).toBytes());
    }
    if (type === 'string' || type.startsWith('vector:')) {
        return Array.from(bcs.ser('string', value).toBytes());
    }
    if (type === 'bool') {
        return Array.from(bcs.ser('bool', value === 'true').toBytes());
    }
    if (type === 'address') {
        return Array.from(bcs.ser('address', value).toBytes());
    }
    throw new Error(`Unsupported type for encoding: ${type}`);
};



/**
 * Helper class which wraps the underlying JSON structure.
 * Provides a way to change the identifiers and update the identifier indexes.
 */
export class CompiledModule {
    
    public inner: MoveCompiledModule;
    public byte_code: Uint8Array;
    public module: string;
    private replaceableConstants: DynamicTemplateField[];

    constructor(public moduleName: string, public base64: string) {
        console.log("Initialized MoveModule with base64:",base64);
        const template_bytecode = base64ToHexClient(base64);
        console.log("Template bytecode:", template_bytecode);
        const move_module = deserializeModule(hexToStringClient(template_bytecode))
        console.log("Move module:", move_module);
        this.inner = move_module;
        this.module = moduleName;
        this.byte_code = hexToStringClient(template_bytecode)
        
        // Get replaceable constants
        this.replaceableConstants = this.getReplaceableConstants();
    }


    /**
     * Get replaceable constants and their types
     */
    getReplaceableConstants(): DynamicTemplateField[] {
        return this.inner.constant_pool.map((constant, index) => {
            const type_ = resolveType(constant.type_);
            const currentValue = decodeValue(type_, constant.data);
            return { name: `constant_${index}`, expectedType: type_, currentValue };
        });
    }
    


    /**
     * Quite dangerous method which updates a constant in the constant pool. To make sure
     * that the index is set correctly, the `expectedValue` and `expectedType` must be provided
     * - this way we at least try to minimize the risk of updating a wrong constant.
     */
    updateConstant2(
        idx: number,
        value: string,
        expectedValue: string,
        expectedType: string
    ) {
        if (idx >= this.inner.constant_pool.length) {
            throw new Error("Invalid constant index; no constant exists at this index");
        }

        let { type_, data } = this.inner.constant_pool[idx];
        const resolvedType = resolveType(type_);
        if (expectedType.toLowerCase() !== resolvedType.toLowerCase()) {
            throw new Error(`Invalid constant type; expected ${expectedType}, got ${resolvedType}`);
        }


        const oldValue = decodeValue(resolvedType, data);

        if (oldValue !== expectedValue) {
            throw new Error(`Invalid constant value; expected ${expectedValue}, got ${oldValue}`);
        }

        this.inner.constant_pool[idx].data = [
            ...encodeValue(resolvedType, value)
        ];

        console.log("idx", idx);
        console.log("value", value);
        console.log("Resolved type:", resolvedType);
        console.log("Expected type:", expectedType);
        console.log("OldValue type:", oldValue);
        console.log("NewValue type:", encodeValue(resolvedType, value));
        
        return this;
    }

    /**
     * Update a constant in the constant pool using the provided API.
     */
    updateConstant(
        idx: number,
        value: string,
        expectedValue: string,
        expectedType: string
    ) {
        const resolvedType = resolveType(this.inner.constant_pool[idx].type_);
        const oldValue = decodeValue(resolvedType, this.inner.constant_pool[idx].data);

        if (expectedType.toLowerCase() !== resolvedType.toLowerCase()) {
            throw new Error(`Invalid constant type; expected ${expectedType}, got ${resolvedType}`);
        }
        if (oldValue !== expectedValue) {
            throw new Error(`Invalid constant value; expected ${expectedValue}, got ${oldValue}`);
        }

        const newEncodedValue = new Uint8Array(encodeValue(resolvedType, value));
        const expectedEncodedValue = new Uint8Array(encodeValue(resolvedType, expectedValue));
        this.byte_code = template.update_constants(
            this.byte_code,
            newEncodedValue,
            expectedEncodedValue,
            template.get_constants(this.byte_code)[idx].type_
        );
        return this;
    }

     /**
     * Update identifiers using the provided API.
     */
     changeIdentifiers(identMap: Record<string, string>): CompiledModule {
        this.byte_code = template.update_identifiers(this.byte_code, identMap);
        return this;
    }

    
    /**
     * Replace constants and identifiers in the module.
     * 
     * @param module The new module name
     * @param content The dynamic content to replace
     * @returns The updated module
     */
    replaceConstantsAndIdentifiers<T extends DynamicTemplateField>(module: string,content: TemplateDynamicContent<T>) {
        // 校验并更新常量
        for (const constant of content.constants) {
            const targetField = this.replaceableConstants.find(field => field.name === constant.name);
            if (!targetField) {
                throw new Error(`Constant with name ${constant.name} not found in replaceable constants.`);
            }
            if (constant.expectedValue !== targetField.currentValue || constant.expectedType !== targetField.expectedType) {
                throw new Error(`ConstantReplacement values do not match the expected DynamicTemplateField values for ${constant.name}.`);
            }

            const idx = parseInt(constant.name.split('_')[1], 10);
            this.updateConstant(idx, constant.newValue, constant.expectedValue, constant.expectedType);
        }

        // update the module identifiers
        this.changeIdentifiers(content.identifiers);

        // update the module name
        const identMap: Record<string, string> = {};
        identMap[this.module] = module;
        identMap[this.module.toUpperCase()] = module.toUpperCase();
        console.log("Updated modulessss:", identMap);
        this.changeIdentifiers(identMap);
        this.module = module;

        this.inner = deserializeModule(this.byte_code);
        console.log("Updated module:", this.inner);
    }

    toJSON() {
        return JSON.stringify(this.inner);
    }

    /**
     * Serialize the module to bytecode.
     */
    toBytecode(): Uint8Array {
        return template.serialize(this.toJSON())
    }
    
}


/**
 * Rust representation of the compiled module; generated by the
 * `deserialize` call in the Wasm module.
 */
export interface MoveCompiledModule {
    version: number;
    self_module_handle_idx: number;
    module_handles: {
        address: number;
        name: number;
    }[];
    struct_handles: {
        module: number;
        name: number;
        abilities: number;
        type_parameters: {
            constraints: number;
            is_phantom: boolean;
        }[];
    }[];
    function_handles: {
        module: number;
        name: number;
        parameters: number;
        return_: number;
        type_parameters: number[];
    }[];
    field_handles: {
        module: number;
        name: number;
    }[];
    friend_decls: any[]; // 根据需要定义具体类型
    struct_def_instantiations: any[]; // 根据需要定义具体类型
    function_instantiations: {
        handle: number;
        type_parameters: number[];
    }[];
    field_instantiations: any[]; // 根据需要定义具体类型
    signatures: {
        parameters: any[]; // 根据需要定义具体类型
        return_: any[]; // 根据需要定义具体类型
    }[];
    identifiers: string[];
    address_identifiers: string[];
    constant_pool: {
        type_: string | { Vector: string }; // 更加明确类型
        data: number[];
    }[];
    metadata: any[]; // 根据需要定义具体类型
    struct_defs: {
        struct_handle: number;
        field_information: {
            Declared: {
                name: number;
                signature: string | { Struct: number }; // 更加明确类型
            }[];
        };
    }[];
    function_defs: {
        function: number;
        visibility: "Private" | "Public";
        is_entry: boolean;
        acquires_global_resources: any[]; // 根据需要定义具体类型
        code: {
            locals: number;
            code: any[]; // 根据需要定义具体类型
        };
    }[];
}

