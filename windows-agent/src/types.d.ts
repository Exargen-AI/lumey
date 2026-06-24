// Ambient declarations for the standalone Pulse agent.
//
// We intentionally keep this stub minimal — the agent is shipped as a
// single packaged .exe via `pkg`, and node-windows is a thin SCM
// wrapper without official types. A handful of declarations here let
// the agent build without hauling in DefinitelyTyped packages.

declare namespace NodeJS {
  interface Process {
    // Set by `pkg` at runtime when the agent is running from the
    // packaged binary. Undefined under `node dist/index.js`.
    pkg?: { entrypoint: string };
  }
}

declare module 'node-windows' {
  // Minimal subset of the node-windows Service API we use. The library
  // ships no TypeScript types; this stub keeps the install-service.ts
  // file type-safe without pulling in @types/node-windows (no such
  // package exists at the time of writing).
  export interface ServiceOptions {
    name: string;
    description?: string;
    script: string;
    nodeOptions?: string[];
    wait?: number;
    grow?: number;
    maxRetries?: number;
  }

  type EventHandler = (...args: any[]) => void;

  export class Service {
    constructor(opts: ServiceOptions);
    on(event: 'install' | 'alreadyinstalled' | 'uninstall' | 'error', cb: EventHandler): void;
    install(): void;
    uninstall(): void;
    start(): void;
    stop(): void;
  }
}
