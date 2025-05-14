import '@radix-ui/themes/styles.css';
import { Theme, Flex, Heading, Container, Button, Grid, Box, Select } from '@radix-ui/themes'
import { ConnectButton, useCurrentAccount, useSignAndExecuteTransactionBlock, useSuiClient, useSuiClientQuery } from '@mysten/dapp-kit';
import { TemplateEditor } from './Template';
import { useEffect, useState } from 'react';
import { NET_ENV } from './Constants';

export default function App() {
  const account = useCurrentAccount();
  const [network, setNetwork] = useState(NET_ENV);
  
  // 处理网络变更
  const handleNetworkChange = (value: string) => {
    setNetwork(value);
    localStorage.setItem("NET_ENV", value);
    // 刷新页面以应用新网络
    window.location.reload();
  };
  
  console.log("account", account?.address);
  return (
    <Theme>
      <Flex justify="between" align={"center"} style={{ minHeight: 65, maxHeight: 65 }} >
        <Heading color="cyan">Publish Move Module</Heading>
        <Flex align="center" gap="3">
          <Select.Root value={network} onValueChange={handleNetworkChange}>
            <Select.Trigger placeholder="选择网络" />
            <Select.Content>
              <Select.Item value="localnet">Localnet</Select.Item>
              <Select.Item value="devnet">Devnet</Select.Item>
              <Select.Item value="testnet">Testnet</Select.Item>
              <Select.Item value="mainnet">Mainnet</Select.Item>
            </Select.Content>
          </Select.Root>
          <ConnectButton />
        </Flex>
      </Flex>

      <Container>
        <TemplateEditor/>
      </Container>
    </Theme >
  )
}