import { AppText } from '@/components/ui/AppText';
import { Colors } from '@/constants/theme';
import { tradeReceipt } from '@/lib/tradeReceipt';
import type { TradeSubmission } from '@/lib/tradeTicketModel';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';
import { styles } from './tradeTicketStyles';

/** Only exceptional results stay in the ticket; normal fills use a brief banner. */
export function ResultView({ coin, submission, priceDecimals, onDone }: {
  coin: string; submission: TradeSubmission; priceDecimals: number; onDone: () => void;
}) {
  const receipt = tradeReceipt(submission, coin, priceDecimals);
  const color = receipt.tone === 'error' ? Colors.down : Colors.warning;
  return <View style={styles.inlineFeedback} accessibilityLiveRegion="polite">
    <Ionicons name="alert-circle-outline" size={22} color={color} />
    <View style={styles.feedbackCopy}>
      <AppText variant="label" color={color}>{receipt.title}</AppText>
      <AppText variant="caption" numeric>{receipt.detail}</AppText>
      {receipt.protection ? <AppText variant="caption" color={Colors.warning}>{receipt.protection}</AppText> : null}
    </View>
    <Pressable onPress={onDone} accessibilityRole="button" style={styles.feedbackDone}><AppText variant="label" color={Colors.accent}>Done</AppText></Pressable>
  </View>;
}
