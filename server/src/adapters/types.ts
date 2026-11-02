import type { CenterEvent } from "../domain/types.js";

/**
 * A source of call-center events. The simulated adapter is the default and
 * what the tests drive. The AMI adapter speaks Asterisk Manager.
 * Both push the same events into the reducer.
 */
export interface DataSourceAdapter {
  readonly name: string;
  start(emit: (event: CenterEvent) => void): Promise<void>;
  stop(): Promise<void>;
}
