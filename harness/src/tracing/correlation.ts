import { v7 as uuidv7 } from 'uuid';

export function generateTraceId(): string {
  return uuidv7();
}
