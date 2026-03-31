import type { Edge, NodeDef, RunContext, WorkflowOptions } from "./types.js";

export class Workflow {
  readonly name: string;
  readonly executor: string;
  readonly dockerImage: string | undefined;

  private nodes = new Map<string, NodeDef>();
  private edges = new Map<string, Edge>();
  private nodeOrder: string[] = [];

  constructor(options: WorkflowOptions) {
    this.name = options.name;
    this.executor = options.executor;
    this.dockerImage = options.dockerImage;
  }

  addNode(id: string, def: NodeDef): this {
    if (this.nodes.has(id)) {
      throw new Error(`Node "${id}" already exists`);
    }
    this.nodes.set(id, def);
    this.nodeOrder.push(id);
    return this;
  }

  addEdge(from: string, to: string): this {
    this.assertNodeExists(from);
    this.assertNodeExists(to);
    if (this.edges.has(from)) {
      throw new Error(`Node "${from}" already has an outgoing edge`);
    }
    this.edges.set(from, { type: "static", target: to });
    return this;
  }

  addConditionalEdge(from: string, fn: (ctx: RunContext) => string): this {
    this.assertNodeExists(from);
    if (this.edges.has(from)) {
      throw new Error(`Node "${from}" already has an outgoing edge`);
    }
    this.edges.set(from, { type: "conditional", fn });
    return this;
  }

  getEntryNode(): string {
    if (this.nodeOrder.length === 0) {
      throw new Error("Workflow has no nodes");
    }
    return this.nodeOrder[0]!;
  }

  getNode(id: string): NodeDef {
    const node = this.nodes.get(id);
    if (!node) {
      throw new Error(`Node "${id}" does not exist`);
    }
    return node;
  }

  getEdge(id: string): Edge | undefined {
    return this.edges.get(id);
  }

  private assertNodeExists(id: string): void {
    if (!this.nodes.has(id)) {
      throw new Error(`Node "${id}" does not exist`);
    }
  }
}
