// SPDX-License-Identifier: Apache-2.0

import { BCS, getRustConfig,fromHEX } from "@mysten/bcs";
const bcs = new BCS(getRustConfig());

export const base64ToHexClient = (base64: string): string => {
  return [...atob(base64)].map(char => 
    char.charCodeAt(0).toString(16).padStart(2, '0')
  ).join('');
}

export const hexToStringClient = (hex: string): Uint8Array => {
  return fromHEX(hex);
}


/**
 * BCS instance
 */
export { bcs,fromHEX };
