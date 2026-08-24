import { handleDailyRequest } from "../../_lib/daily-handler.js";

export const onRequest = (context) => handleDailyRequest({ request: context.request, env: context.env });
