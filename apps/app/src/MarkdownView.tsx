/** Headless markdown for coach replies: parse with mdast (CommonMark + GFM tables, no DOM), render with our own RN components.
    Every text size derives from one `size` base so coach replies match the rest of the chat type. */
import { Linking, Platform, StyleSheet, Text, type TextStyle, View } from "react-native";

import { inlineSpans, type Node, parse } from "@/markdown";

function spans(node: Node, color: string) {
  return inlineSpans(node).map((s, i) => (
    <Text
      key={i}
      onPress={s.href ? () => void Linking.openURL(s.href as string) : undefined}
      style={[{ color }, s.bold && styles.bold, s.italic && styles.italic, s.code && styles.code, s.href && styles.link] as TextStyle[]}
    >
      {s.text}
    </Text>
  ));
}

function block(node: Node, key: number, color: string, size: number): React.ReactNode {
  const p = { fontSize: size, lineHeight: Math.round(size * 1.5) };
  switch (node.type) {
    case "paragraph":
      return <Text key={key} style={[p, { color }]}>{spans(node, color)}</Text>;
    case "heading":
      return <Text key={key} style={[p, styles.bold, { color, fontSize: size + Math.max(0, 3 - (node.depth ?? 1)) * 2 }]}>{spans(node, color)}</Text>;
    case "code":
      return <Text key={key} style={[p, styles.code, { color }]}>{node.value}</Text>;
    case "thematicBreak":
      return <View key={key} style={styles.hr} />;
    case "blockquote":
      return <View key={key} style={styles.quote}>{(node.children ?? []).map((c, i) => block(c, i, color, size))}</View>;
    case "list":
      return (
        <View key={key} style={styles.list}>
          {(node.children ?? []).map((li, i) => (
            <View key={i} style={styles.row}>
              <Text style={[p, { color }]}>{node.ordered ? `${(node.start ?? 1) + i}.  ` : "•  "}</Text>
              <View style={styles.fill}>{(li.children ?? []).map((c, j) => block(c, j, color, size))}</View>
            </View>
          ))}
        </View>
      );
    case "table":
      return (
        <View key={key} style={styles.table}>
          {(node.children ?? []).map((rowNode, ri) => (
            <View key={ri} style={styles.trow}>
              {(rowNode.children ?? []).map((cell, ci) => (
                <View key={ci} style={styles.cell}>
                  <Text style={[{ fontSize: Math.round(size * 0.95) }, ri === 0 && styles.bold, { color }]}>{spans(cell, color)}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      );
    default:
      return null;
  }
}

/** Render markdown `text` (CommonMark + GFM tables) as native RN text, all sized from `size`. */
export function Markdown({ text, color = "#111", size = 15 }: { text: string; color?: string; size?: number }) {
  return <View style={{ gap: Math.round(size * 0.3) }}>{(parse(text).children ?? []).map((n, i) => block(n, i, color, size))}</View>;
}

const styles = StyleSheet.create({
  bold: { fontWeight: "600" },
  italic: { fontStyle: "italic" },
  code: { fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }) },
  link: { textDecorationLine: "underline" },
  list: { gap: 2 },
  row: { flexDirection: "row" },
  fill: { flex: 1 },
  hr: { height: 1, backgroundColor: "#9ca3af", marginVertical: 4 },
  quote: { borderLeftWidth: 3, borderLeftColor: "#9ca3af", paddingLeft: 8 },
  table: { borderColor: "#9ca3af", borderWidth: StyleSheet.hairlineWidth, borderRadius: 6, marginVertical: 2, overflow: "hidden" },
  trow: { flexDirection: "row" },
  cell: { flex: 1, padding: 6, borderColor: "#9ca3af", borderWidth: StyleSheet.hairlineWidth },
});
