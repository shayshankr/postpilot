import "./db/client";
import { config } from "./config";
import { createServer } from "./server";
import { startScheduler } from "./scheduler/scheduler";

const app = createServer();

app.listen(config.port, () => {
  console.log(`[server] listening on port ${config.port}`);
  console.log(`[server] connect LinkedIn at http://localhost:${config.port}/auth/linkedin (or your deployed URL)`);
  startScheduler();
});
