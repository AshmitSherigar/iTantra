import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StyleSheet,
} from 'react-native';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useWifiTransport } from '../../transport/useWifiTransport';

type ChatBubble = {
  id: string;
  text: string;
  sender: 'me' | 'other';
};

export default function WifiScreen() {
  const { colors } = useTheme();

  const [deviceName] = useState(
    () => `Phone-${Math.floor(Math.random() * 1000)}`,
  );
  const [role, setRole] = useState<'host' | 'client' | null>(null);
  const [connectingAddress, setConnectingAddress] = useState<string | null>(
    null,
  );
  const [message, setMessage] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatBubble[]>([]);
  const processedIncomingCount = useRef(0);

  const { status, messages, peers, startHosting, connectTo, sendText, disconnect } =
    useWifiTransport(deviceName);

  const isConnected = status === 'connected';

  // The hook only accumulates messages received from the peer, so merge new
  // arrivals into the local chat list without re-adding ones already shown.
  useEffect(() => {
    if (messages.length <= processedIncomingCount.current) return;
    const newOnes = messages.slice(processedIncomingCount.current);
    processedIncomingCount.current = messages.length;
    setChatMessages((prev) => [
      ...prev,
      ...newOnes
        .filter((m) => m.text)
        .map((m) => ({ id: `other-${m.seq}-${m.ts}`, text: m.text!, sender: 'other' as const })),
    ]);
  }, [messages]);

  useEffect(() => {
    if (isConnected) {
      setConnectingAddress(null);
    }
    if (status === 'idle' || status === 'disconnected') {
      setRole(null);
      processedIncomingCount.current = 0;
      setChatMessages([]);
    }
  }, [status, isConnected]);

  const handleHostPress = useCallback(() => {
    setRole('host');
    startHosting();
  }, [startHosting]);

  const handleConnectPress = useCallback(
    (address: string) => {
      setRole('client');
      setConnectingAddress(address);
      connectTo(address);
    },
    [connectTo],
  );

  const handleDisconnectPress = useCallback(() => {
    disconnect();
    setRole(null);
  }, [disconnect]);

  const sendMessage = useCallback(() => {
    const trimmed = message.trim();
    if (!trimmed) return;
    const sent = sendText(trimmed);
    if (sent) {
      setChatMessages((prev) => [
        ...prev,
        { id: `me-${sent.seq}-${sent.ts}`, text: trimmed, sender: 'me' },
      ]);
    }
    setMessage('');
  }, [message, sendText]);

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      <View
        style={[
          styles.header,
          { backgroundColor: colors.surface, borderBottomColor: colors.border },
        ]}
      >
        <View>
          <Text style={[styles.headerLabel, { color: colors.textSecondary }]}>
            VaaniSetu
          </Text>
        </View>

        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor: isConnected
                ? '#DCFCE7'
                : colors.inputBackground,
            },
          ]}
        >
          <Text
            style={[
              styles.statusText,
              { color: isConnected ? colors.success : colors.textSecondary },
            ]}
          >
            {isConnected
              ? 'Connected'
              : status === 'listening'
                ? 'Listening'
                : status === 'connecting'
                  ? 'Connecting…'
                  : 'Not started'}
          </Text>
        </View>
      </View>

      {!isConnected ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Spacing.xl },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.section}>
            <Text
              style={[
                styles.sectionDescription,
                { color: colors.textSecondary },
              ]}
            >
              Devices on the same WiFi network discover each other
              automatically. Tap Host on one phone, then Connect from the
              other.
            </Text>
            <Text style={[styles.nameLabel, { color: colors.textSecondary }]}>
              YOUR DEVICE NAME
            </Text>
            <Text style={[styles.advertisedAs, { color: colors.text }]}>
              {deviceName}
            </Text>

            <TouchableOpacity
              style={[
                styles.primaryButton,
                {
                  backgroundColor:
                    status === 'listening'
                      ? colors.textSecondary
                      : colors.primary,
                  opacity: status === 'listening' ? 0.7 : 1,
                },
              ]}
              onPress={handleHostPress}
              disabled={status === 'listening'}
              activeOpacity={0.82}
            >
              {status === 'listening' ? (
                <ActivityIndicator
                  color="#FFFFFF"
                  size="small"
                  style={styles.buttonIcon}
                />
              ) : (
                <Ionicons
                  name="wifi"
                  size={18}
                  color="#FFFFFF"
                  style={styles.buttonIcon}
                />
              )}
              <Text style={styles.primaryButtonText}>
                {status === 'listening'
                  ? 'Listening for connections…'
                  : 'Host'}
              </Text>
            </TouchableOpacity>

            {status === 'listening' ? (
              <TouchableOpacity
                style={[
                  styles.stopButton,
                  { backgroundColor: colors.inputBackground },
                ]}
                onPress={handleDisconnectPress}
                activeOpacity={0.82}
              >
                <Text style={[styles.stopButtonText, { color: colors.text }]}>
                  Stop hosting
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  Nearby VaaniSetu Devices
                </Text>
                <Text
                  style={[styles.deviceCount, { color: colors.textSecondary }]}
                >
                  {peers.length} device{peers.length === 1 ? '' : 's'} found
                </Text>
              </View>
            </View>

            {peers.length === 0 ? (
              <View
                style={[
                  styles.emptyState,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Ionicons
                  name="wifi-outline"
                  size={32}
                  color={colors.textSecondary}
                  style={{ marginBottom: Spacing.sm }}
                />
                <Text style={[styles.emptyStateTitle, { color: colors.text }]}>
                  No VaaniSetu devices found
                </Text>
                <Text
                  style={[
                    styles.emptyStateText,
                    { color: colors.textSecondary },
                  ]}
                >
                  Only phones running this app on the same WiFi network appear
                  here.
                </Text>
              </View>
            ) : (
              <View style={styles.deviceList}>
                {peers.map((peer) => (
                  <View
                    key={peer.address}
                    style={[
                      styles.deviceCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <View style={styles.deviceInfo}>
                      <Text
                        style={[styles.deviceName, { color: colors.text }]}
                        numberOfLines={1}
                      >
                        {peer.name}
                      </Text>
                      <Text
                        style={[
                          styles.deviceId,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {peer.address}
                      </Text>
                    </View>

                    <TouchableOpacity
                      style={[
                        styles.connectButton,
                        { backgroundColor: colors.primary },
                      ]}
                      disabled={connectingAddress !== null}
                      onPress={() => handleConnectPress(peer.address)}
                      activeOpacity={0.82}
                    >
                      {connectingAddress === peer.address ? (
                        <ActivityIndicator color="#FFFFFF" size="small" />
                      ) : (
                        <Text style={styles.connectButtonText}>Connect</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      ) : (
        <View style={styles.flex}>
          <View
            style={[
              styles.connectionBar,
              {
                backgroundColor: colors.surface,
                borderBottomColor: colors.border,
              },
            ]}
          >
            <View style={styles.connectionInfo}>
              <View
                style={[
                  styles.connectedDot,
                  { backgroundColor: colors.success },
                ]}
              />
              <View>
                <Text style={[styles.connectedTitle, { color: colors.text }]}>
                  Connected
                </Text>
                <Text
                  style={[
                    styles.connectedRole,
                    { color: colors.textSecondary },
                  ]}
                >
                  {role === 'host' ? 'Host' : 'Client'} • {deviceName}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[
                styles.disconnectButton,
                { backgroundColor: colors.inputBackground },
              ]}
              onPress={handleDisconnectPress}
              activeOpacity={0.8}
            >
              <Text style={[styles.disconnectText, { color: colors.text }]}>
                Disconnect
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.messagesContent}
            keyboardShouldPersistTaps="handled"
          >
            {chatMessages.length === 0 ? (
              <View style={styles.emptyChat}>
                <Ionicons
                  name="chatbubbles-outline"
                  size={48}
                  color={colors.textSecondary}
                  style={{ marginBottom: Spacing.sm }}
                />
                <Text style={[styles.emptyChatTitle, { color: colors.text }]}>
                  Start the conversation
                </Text>
                <Text
                  style={[
                    styles.emptyChatText,
                    { color: colors.textSecondary },
                  ]}
                >
                  Messages from either device will appear here.
                </Text>
              </View>
            ) : (
              chatMessages.map((chatMessage) => (
                <View
                  key={chatMessage.id}
                  style={[
                    styles.messageRow,
                    chatMessage.sender === 'me'
                      ? styles.messageRowMe
                      : styles.messageRowOther,
                  ]}
                >
                  <View
                    style={[
                      styles.messageBubble,
                      chatMessage.sender === 'me'
                        ? [
                            styles.messageBubbleMe,
                            { backgroundColor: colors.primary },
                          ]
                        : [
                            styles.messageBubbleOther,
                            {
                              backgroundColor: colors.surface,
                              borderColor: colors.border,
                            },
                          ],
                    ]}
                  >
                    <Text
                      style={[
                        styles.messageText,
                        chatMessage.sender === 'me'
                          ? styles.messageTextMe
                          : { color: colors.text },
                      ]}
                    >
                      {chatMessage.text}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </ScrollView>

          <View
            style={[
              styles.inputContainer,
              {
                backgroundColor: colors.surface,
                borderTopColor: colors.border,
              },
            ]}
          >
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder="Type a message..."
              placeholderTextColor={colors.textSecondary}
              style={[
                styles.input,
                { backgroundColor: colors.inputBackground, color: colors.text },
              ]}
              multiline
            />

            <TouchableOpacity
              style={[
                styles.sendButton,
                {
                  backgroundColor: message.trim()
                    ? colors.primary
                    : colors.inputBackground,
                },
              ]}
              disabled={!message.trim()}
              onPress={sendMessage}
              activeOpacity={0.82}
            >
              <Ionicons
                name="send"
                size={18}
                color={message.trim() ? '#FFFFFF' : colors.textSecondary}
              />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },

  flex: {
    flex: 1,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
  },

  headerLabel: {
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 2,
  },

  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.sm,
  },

  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },

  scrollContent: {
    padding: Spacing.md,
  },

  section: {
    marginBottom: Spacing.lg,
  },

  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },

  sectionTitle: {
    fontSize: FontSize.medium,
    fontWeight: '700',
  },

  sectionDescription: {
    fontSize: FontSize.small + 2,
    lineHeight: 20,
    marginTop: 6,
    marginBottom: Spacing.md,
  },

  deviceCount: {
    marginTop: 3,
    fontSize: FontSize.small,
  },

  primaryButton: {
    height: 52,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },

  buttonIcon: {
    marginRight: 8,
  },

  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: FontSize.body,
    fontWeight: '700',
  },

  nameLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 6,
  },

  advertisedAs: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 12,
  },

  stopButton: {
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },

  stopButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },

  emptyState: {
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    alignItems: 'center',
    borderWidth: 1,
  },

  emptyStateTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },

  emptyStateText: {
    fontSize: FontSize.small,
    textAlign: 'center',
    lineHeight: 18,
  },

  deviceList: {
    gap: 10,
  },

  deviceCard: {
    borderRadius: Radius.md,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
  },

  deviceInfo: {
    flex: 1,
    marginRight: Spacing.sm,
  },

  deviceName: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 3,
  },

  deviceId: {
    fontSize: 11,
  },

  connectButton: {
    minWidth: 82,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },

  connectButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },

  connectionBar: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  connectionInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },

  connectedDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },

  connectedTitle: {
    fontSize: 15,
    fontWeight: '700',
  },

  connectedRole: {
    fontSize: 11,
    marginTop: 2,
  },

  disconnectButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.sm,
  },

  disconnectText: {
    fontSize: 13,
    fontWeight: '600',
  },

  messagesContent: {
    padding: Spacing.md,
    paddingBottom: Spacing.lg,
    flexGrow: 1,
  },

  emptyChat: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },

  emptyChatTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 6,
  },

  emptyChatText: {
    fontSize: FontSize.small,
    textAlign: 'center',
    lineHeight: 20,
  },

  messageRow: {
    width: '100%',
    marginBottom: 10,
  },

  messageRowMe: {
    alignItems: 'flex-end',
  },

  messageRowOther: {
    alignItems: 'flex-start',
  },

  messageBubble: {
    maxWidth: '78%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 17,
  },

  messageBubbleMe: {
    borderBottomRightRadius: 5,
  },

  messageBubbleOther: {
    borderBottomLeftRadius: 5,
    borderWidth: 1,
  },

  messageText: {
    fontSize: 15,
    lineHeight: 21,
  },

  messageTextMe: {
    color: '#FFFFFF',
  },

  inputContainer: {
    padding: Spacing.sm + 4,
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },

  input: {
    flex: 1,
    minHeight: 46,
    maxHeight: 110,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: Radius.md,
    fontSize: 15,
  },

  sendButton: {
    width: 46,
    height: 46,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
