import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";
import { error as apiError } from "@/utils/apiResponse";

export function validate(schema: ZodSchema, source: "body" | "query" | "params" = "body") {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const messages = result.error.errors
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join(", ");
      return apiError(res, messages, 400);
    }

    req[source] = result.data;
    next();
  };
}
