import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
type PluginContext = Context & {
    webServer?: WebServerLike;
    interval(fn: () => void, ms: number): () => void;
    on(event: string, listener: (...args: any[]) => void): () => void;
};
interface WebServerLike {
    register(route: {
        kind: 'exact' | 'prefix';
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
    }): () => void;
}
export declare const inject: string[];
export declare function apply(ctx: PluginContext): void;
export {};
