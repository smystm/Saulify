export class AnalysisError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = "analysis_error") {
    super(message);
    this.name = "AnalysisError";
    this.status = status;
    this.code = code;
  }
}
