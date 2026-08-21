export class AppError extends Error {
  public constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message);
    this.name = 'AppError';
  }
}
