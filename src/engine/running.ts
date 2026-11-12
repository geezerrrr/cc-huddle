/** Whether process `pid` runs: a leaf, for the MCP server's bootstrap too, before its dependencies are in. */
export function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // There, but not ours to signal.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
