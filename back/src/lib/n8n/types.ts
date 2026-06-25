// Tipos para la integración con n8n v1 REST API

interface N8nNodeParameter {
  [key: string]: unknown;
}

interface N8nNode {
  parameters: N8nNodeParameter;
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
}

interface N8nConnections {
  [nodeName: string]: {
    main: Array<Array<{ node: string; type: string; index: number }>>;
  };
}

export interface N8nWorkflow {
  name: string;
  nodes: N8nNode[];
  connections: N8nConnections;
  settings?: { executionOrder?: string };
}

/** Resultado de cada operación contra el cliente n8n */
export interface SyncResult {
  ok: boolean;
  /** Id del workflow devuelto por n8n, o null en noop / error / 404 */
  workflowId: string | null;
  /** Mapea directamente a Automation.syncStatus */
  status: "synced" | "pending" | "error";
  /** true si n8n respondió 404 (workflow inexistente) */
  notFound?: boolean;
}
