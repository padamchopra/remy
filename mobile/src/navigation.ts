/// Screens that get the whole width. A settings form and a long list of fields
/// belong on top of the shell rather than crammed beside the thread list; the
/// list is one back-tap away, which is what keeps a thread reachable.
export type RootStackParamList = {
  Home: undefined;
  Pair: undefined;
  Scan: undefined;
  Agent: { agentId: string };
  Routine: { routineId: string };
};
