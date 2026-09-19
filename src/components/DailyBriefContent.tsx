import type { ReactNode } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Colors } from '@/constants/theme';
import { safeBriefUrl, type BriefBlock, type BriefInline } from '@tradingview/shared/brief';

export async function openBriefSource(value: string) {
  const url = safeBriefUrl(value);
  if (!url) return;
  try { await Linking.openURL(url); }
  catch { Alert.alert('Unable to open source', 'Please try again when your browser is available.'); }
}

function inline(nodes: BriefInline[]): ReactNode {
  return nodes.map((node, index) => {
    if (node.type === 'break') return '\n';
    if ('text' in node) return <Text key={index} style={node.type === 'code' ? styles.code : undefined}>{node.text}</Text>;
    if (node.type === 'link') return <Text key={index} accessibilityRole="link" onPress={() => void openBriefSource(node.href)} style={styles.link}>{inline(node.children)}</Text>;
    return <Text key={index} style={node.type === 'strong' ? styles.strong : node.type === 'em' ? styles.emphasis : styles.strike}>{inline(node.children)}</Text>;
  });
}

export function DailyBriefContent({ blocks, lead = false }: { blocks: BriefBlock[]; lead?: boolean }) {
  return <>{blocks.map((block, index) => {
    switch (block.type) {
      case 'paragraph':
      case 'heading':
        return <AppText key={index} selectable style={[styles.prose, lead && styles.lead, block.type === 'heading' && styles.strong]}>{inline(block.children)}</AppText>;
      case 'list':
        return <View key={index} style={styles.list}>{block.items.map((item, itemIndex) => <View key={itemIndex} style={styles.listItem}>
          <AppText style={styles.marker}>{block.ordered ? `${block.start + itemIndex}.` : '•'}</AppText>
          <View style={styles.listBody}><DailyBriefContent blocks={item} /></View>
        </View>)}</View>;
      case 'quote': return <View key={index} style={styles.quote}><DailyBriefContent blocks={block.blocks} /></View>;
      case 'code': return <AppText key={index} selectable style={[styles.prose, styles.code]}>{block.text}</AppText>;
      case 'rule': return <View key={index} style={styles.rule} />;
      case 'table': return <ScrollView key={index} horizontal style={styles.table}>
        <View>{[block.header, ...block.rows].map((row, rowIndex) => <View key={rowIndex} style={styles.tableRow}>{row.map((cell, column) => <AppText key={column} style={[styles.tableCell, rowIndex === 0 && styles.strong]}>{inline(cell)}</AppText>)}</View>)}</View>
      </ScrollView>;
    }
  })}</>;
}

const styles = StyleSheet.create({
  prose: { fontSize: 16, lineHeight: 27, color: '#C0CCD2', marginBottom: 16 },
  lead: { fontSize: 19, lineHeight: 30, color: Colors.text, letterSpacing: -0.2 },
  strong: { fontWeight: '600', color: Colors.text },
  emphasis: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  link: { color: '#9BCABC', textDecorationLine: 'underline' },
  code: { fontFamily: 'Menlo', fontSize: 13, color: Colors.textMuted },
  list: { gap: 3 },
  listItem: { flexDirection: 'row', gap: 10 },
  marker: { color: Colors.textFaint, fontSize: 15, lineHeight: 27, minWidth: 12 },
  listBody: { flex: 1 },
  quote: { borderLeftWidth: 2, borderLeftColor: Colors.border, paddingLeft: 16 },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.border, marginVertical: 16 },
  table: { marginBottom: 20 },
  tableRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  tableCell: { width: 180, padding: 12, fontSize: 14, lineHeight: 22 },
});
