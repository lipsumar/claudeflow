import { defineCommand } from "citty";
import { getConfig } from "../../config.js";

export default defineCommand({
  meta: {
    name: "config",
    description: "Print the resolved configuration",
  },
  run() {
    console.log(JSON.stringify(getConfig(), null, 2));
  },
});
