import { urlAPI } from "@/backend";
import type { ResCatalog, ResErrAPI, ResUpload } from "@/types";

type FormField = string | Blob;

function formData(fields: Record<string, FormField>): FormData {
  const form: FormData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  return form;
}

async function postForm<T>(
  path: string,
  fields: Record<string, FormField>,
  fallbackError: string,
): Promise<T> {
  const res: Response = await fetch(urlAPI(path), {
    method: "POST",
    body: formData(fields),
  });

  const data = (await res.json()) as T & ResErrAPI;

  if (!res.ok) {
    throw new Error(data.detail || fallbackError);
  }

  return data;
}

export async function fetchCatalog(errorMessage: (status: number) => string): Promise<ResCatalog> {
  const res: Response = await fetch(urlAPI("/api/info"));
  if (!res.ok) {
    throw new Error(errorMessage(res.status));
  }
  return (await res.json()) as ResCatalog;
}

export function loadModelRequest(
  game: string,
  model: string,
  fallbackError: string,
): Promise<ResUpload> {
  return postForm<ResUpload>("/api/models/load", { game, model }, fallbackError);
}

export function uploadModelRequest(
  file: File,
  game: string,
  fallbackError: string,
): Promise<ResUpload> {
  return postForm<ResUpload>(
    "/api/models/upload",
    {
      file,
      kind: "auto",
      game,
    },
    fallbackError,
  );
}
