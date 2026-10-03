/** Close every acquired resource, including when boot fails partway through. Preserve the first failure. */
export class WorkerResources {
  private readonly resources: { name: string; close: () => void | Promise<void> }[] = [];
  add(name: string, close: () => void | Promise<void>): void { this.resources.push({ name, close }); }
  async close(report: (name: string) => void): Promise<void> {
    let failed = false;
    for (const resource of this.resources.splice(0).reverse()) {
      try { await resource.close(); }
      catch { failed = true; report(resource.name); }
    }
    if (failed) throw new Error("Worker resource cleanup failed");
  }
}
