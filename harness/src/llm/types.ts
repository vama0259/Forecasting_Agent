import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { createMiddleware } from 'langchain';

export type MiddlewareType = ReturnType<typeof createMiddleware>;

export interface ModelWithMiddlewares {
  model: BaseChatModel;
  middlewares: MiddlewareType[];
}
