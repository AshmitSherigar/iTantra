import { StyleSheet } from 'react-native';
import { FontSize, Radius, Spacing } from '../../constants/theme';

export const styles = StyleSheet.create({
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
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
  },

  headerTitle: {
    marginTop: 4,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },

  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.round,
  },

  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
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

  nameInput: {
    height: 48,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    fontSize: 15,
    marginBottom: 8,
  },

  advertisedAs: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },

  btErrorBox: {
    marginBottom: 10,
    gap: 4,
  },

  btErrorText: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },

  btErrorLink: {
    fontSize: 13,
    fontWeight: '700',
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

  scanButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: Radius.sm,
  },

  scanButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
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

  deviceRssi: {
    fontSize: 12,
    marginTop: 3,
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

  messageTextOther: {},

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

  micButton: {
    width: 46,
    height: 46,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },

  voiceIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderTopWidth: 1,
  },

  voiceIndicatorIcon: {
    marginRight: 8,
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },

  voiceIndicatorTextContainer: {
    flex: 1,
  },

  voiceIndicatorText: {
    fontSize: 13,
    fontWeight: '600',
  },

  partialTranscript: {
    fontSize: 14,
    marginTop: 4,
    fontStyle: 'italic',
  },

  recordingPulse: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#DC2626',
  },

  voiceErrorBar: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderTopWidth: 1,
    backgroundColor: '#FEF2F2',
  },

  voiceErrorText: {
    fontSize: 12,
    fontWeight: '500',
  },

  ttsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm + 4,
    paddingVertical: 8,
    borderTopWidth: 1,
    gap: 8,
  },

  ttsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.sm,
  },

  ttsToggleText: {
    fontSize: 13,
    fontWeight: '700',
  },

  ttsStatus: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },

  ttsStop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.sm,
  },

  ttsStopText: {
    fontSize: 13,
    fontWeight: '700',
  },

  sttBar: {
    paddingHorizontal: Spacing.sm + 4,
    paddingVertical: 8,
    borderTopWidth: 1,
  },

  sttStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  statusDotSmall: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  sttStatusText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },
});
