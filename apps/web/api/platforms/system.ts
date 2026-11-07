import { apiRequest } from "../client";

export const systemApi = {
  getHello: () => apiRequest<string>("/"),
};
