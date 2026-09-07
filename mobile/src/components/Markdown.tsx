import type { ReactElement } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, radius } from "../theme";

type Block =
  | { kind: "paragraph" | "quote"; text: string }
  | { kind: "heading"; text: string; level: number }
  | { kind: "fence"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; rows: string[][] };

/// Phone-sized Markdown with the structures a coding thread commonly uses.
/// Code and tables scroll sideways so one long line never widens the feed.
export function Markdown({ text }: { text: string }) {
  return (
    <View style={styles.wrap}>
      {blocks(text).map((block, index) => {
        if (block.kind === "fence") {
          return (
            <ScrollView key={index} horizontal style={styles.codeScroll} showsHorizontalScrollIndicator={false}>
              <Text style={styles.fence}>{block.text}</Text>
            </ScrollView>
          );
        }
        if (block.kind === "heading") {
          return <Text key={index} style={block.level === 1 ? styles.h1 : styles.heading}>{inline(block.text)}</Text>;
        }
        if (block.kind === "quote") return <Text key={index} style={styles.quote}>{inline(block.text)}</Text>;
        if (block.kind === "list") {
          return (
            <View key={index} style={styles.list}>
              {block.items.map((item, itemIndex) => (
                <View key={itemIndex} style={styles.listRow}>
                  <Text style={styles.marker}>{block.ordered ? `${itemIndex + 1}.` : "•"}</Text>
                  <Text style={styles.listText}>{inline(item)}</Text>
                </View>
              ))}
            </View>
          );
        }
        if (block.kind === "table") return <Table key={index} rows={block.rows} />;
        return <Text key={index} style={styles.paragraph}>{inline(block.text)}</Text>;
      })}
    </View>
  );
}

function blocks(value: string): Block[] {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const result: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.trimStart().startsWith("```")) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trimStart().startsWith("```")) body.push(lines[index++]);
      if (index < lines.length) index += 1;
      result.push({ kind: "fence", text: body.join("\n") });
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      result.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) quoted.push(lines[index++].replace(/^>\s?/, ""));
      result.push({ kind: "quote", text: quoted.join("\n") });
      continue;
    }
    const list = /^(\s*)([-*]|\d+\.)\s+(.+)$/.exec(line);
    if (list) {
      const ordered = /\d/.test(list[2]);
      const items: string[] = [];
      while (index < lines.length) {
        const item = /^(\s*)([-*]|\d+\.)\s+(.+)$/.exec(lines[index]);
        if (!item || /\d/.test(item[2]) !== ordered) break;
        items.push(item[3]);
        index += 1;
      }
      result.push({ kind: "list", ordered, items });
      continue;
    }
    if (line.includes("|") && tableDivider(lines[index + 1])) {
      const rows = [cells(line)];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) rows.push(cells(lines[index++]));
      result.push({ kind: "table", rows });
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !startsBlock(lines, index)) paragraph.push(lines[index++]);
    result.push({ kind: "paragraph", text: paragraph.join("\n") });
  }
  return result;
}

function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index];
  return line.trimStart().startsWith("```")
    || /^(#{1,3})\s+/.test(line)
    || /^>\s?/.test(line)
    || /^(\s*)([-*]|\d+\.)\s+/.test(line)
    || (line.includes("|") && tableDivider(lines[index + 1]));
}

function tableDivider(line?: string): boolean {
  if (!line) return false;
  const parts = cells(line);
  return parts.length > 0 && parts.every((part) => /^:?-{3,}:?$/.test(part));
}

function cells(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

function Table({ rows }: { rows: string[][] }) {
  return (
    <ScrollView horizontal style={styles.tableScroll} showsHorizontalScrollIndicator={false}>
      <View style={styles.table}>
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={[styles.tableRow, rowIndex === 0 && styles.tableHead]}>
            {row.map((cell, cellIndex) => (
              <Text key={cellIndex} style={[styles.cell, rowIndex === 0 && styles.cellHead]}>{inline(cell)}</Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function inline(text: string): (string | ReactElement)[] {
  const nodes: (string | ReactElement)[] = [];
  const pattern = /(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
    if (link) {
      nodes.push(
        <Text key={key++} style={styles.link} accessibilityRole="link" onPress={() => void Linking.openURL(link[2])}>
          {link[1]}
        </Text>,
      );
    } else if (token.startsWith("**")) {
      nodes.push(<Text key={key++} style={styles.bold}>{token.slice(2, -2)}</Text>);
    } else if (token.startsWith("`")) {
      nodes.push(<Text key={key++} style={styles.inlineCode}>{token.slice(1, -1)}</Text>);
    } else {
      nodes.push(<Text key={key++} style={styles.italic}>{token.slice(1, -1)}</Text>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const styles = StyleSheet.create({
  wrap: { gap: 10, minWidth: 0 },
  paragraph: { color: color.foreground, fontSize: 15, lineHeight: 22 },
  h1: { color: color.foreground, fontSize: 20, lineHeight: 26, fontWeight: "700" },
  heading: { color: color.foreground, fontSize: 17, lineHeight: 23, fontWeight: "600" },
  quote: {
    color: color.mutedForeground,
    fontSize: 15,
    lineHeight: 22,
    borderLeftWidth: 3,
    borderLeftColor: color.border,
    paddingLeft: 10,
  },
  codeScroll: { maxWidth: "100%", backgroundColor: color.muted, borderRadius: radius.md },
  fence: { fontFamily: "Menlo", fontSize: 12, lineHeight: 18, color: color.foreground, padding: 10 },
  list: { gap: 4 },
  listRow: { flexDirection: "row", alignItems: "flex-start", gap: 7 },
  marker: { width: 20, color: color.mutedForeground, fontSize: 15, lineHeight: 22, textAlign: "right" },
  listText: { flex: 1, color: color.foreground, fontSize: 15, lineHeight: 22 },
  tableScroll: { maxWidth: "100%", borderWidth: 1, borderColor: color.border, borderRadius: radius.md },
  table: { minWidth: 280 },
  tableRow: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border },
  tableHead: { borderTopWidth: 0, backgroundColor: color.muted },
  cell: { minWidth: 120, maxWidth: 220, padding: 8, color: color.foreground, fontSize: 13, lineHeight: 18 },
  cellHead: { fontWeight: "700" },
  bold: { fontWeight: "700", color: color.foreground },
  italic: { fontStyle: "italic", color: color.foreground },
  inlineCode: { fontFamily: "Menlo", fontSize: 13, color: color.foreground, backgroundColor: color.muted },
  link: { color: color.info, textDecorationLine: "underline" },
});
