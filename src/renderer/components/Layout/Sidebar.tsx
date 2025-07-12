import { Box, Flex, Heading, ScrollArea, Text } from '@radix-ui/themes'
import { Logo } from '../ui'
import { ThemeSwitcher } from '../ThemeSwitcher'
import { ConnectionList } from '../ConnectionList/ConnectionList'
import './Sidebar.css'

interface SidebarProps {
  onConnectionSelect?: (connection: any) => void
  onConnectionDelete?: (connectionId: string) => void
}

export function Sidebar({ onConnectionSelect, onConnectionDelete }: SidebarProps) {
  return (
    <Box className="sidebar">
      <Flex direction="column" gap="4" p="4" height="100%">
        <Flex justify="between" align="center">
          <Flex align="center" gap="2">
            <Logo size={28} withBackground />
            <Heading size="4" weight="bold">
              DataPup
            </Heading>
          </Flex>
          <ThemeSwitcher />
        </Flex>

        <Box style={{ flex: 1, minHeight: 0 }}>
          <Text size="2" weight="medium" color="gray" mb="2">
            Saved Connections
          </Text>
          <ScrollArea className="connections-list">
            <ConnectionList
              onConnectionSelect={onConnectionSelect}
              onConnectionDelete={onConnectionDelete}
            />
          </ScrollArea>
        </Box>
      </Flex>
    </Box>
  )
}
