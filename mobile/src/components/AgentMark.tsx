import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { blobatar } from "blobatar/blob";
import { radius } from "../theme";
import { blobatarOptions } from "../lib/agent-avatar";
import type { Agent } from "../state/types";

/// An agent's own face, wherever it is named. Generated on the phone from the
/// same seed the window uses, so it is recognised rather than read.
export function AgentMark({
  agent,
  size = 32,
}: {
  agent: Pick<Agent, "id" | "avatar" | "tint" | "builtIn">;
  size?: number;
}) {
  const xml = useMemo(() => {
    const { name, options } = blobatarOptions(agent);
    return blobatar(name, options);
  }, [agent.id, agent.avatar, agent.tint, agent.builtIn]);

  return (
    <View style={[styles.mark, { width: size, height: size, borderRadius: size >= 32 ? radius.md : radius.sm }]}>
      <SvgXml xml={xml} width={size} height={size} />
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { overflow: "hidden" },
});
