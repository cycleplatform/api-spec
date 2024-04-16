import $RefParser from "@apidevtools/json-schema-ref-parser";
import fs from "fs";
import path from "path";

async function bundleStackSpecSchema() {
  try {
    const parser = new $RefParser();

    const input = path.join(
      __dirname,
      "../components/schemas/stacks/spec/StackSpec.yml"
    );

    const output = path.join(__dirname, "./stackspec.json");

    const schema = await parser.bundle(input, { mutateInputSchema: false });
    fs.writeFileSync(output, JSON.stringify(schema));
  } catch (err) {
    console.error(err);
  }
}
bundleStackSpecSchema();
