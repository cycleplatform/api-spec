type OpenAPISpec31 = {
  openapi: "3.1.0";
  components?: ComponentsObject;
  paths?: Record<string, PathItemObject>;
  webhooks?: Record<string, any>;
  [key: string]: any;
};

type OpenAPISpec30 = {
  openapi: "3.0.1";
  components?: ComponentsObject;
  paths?: Record<string, PathItemObject>;
  [key: string]: any;
};

type ComponentsObject = {
  schemas?: Record<string, SchemaObject>;
  [key: string]: any;
};

type PathItemObject = {
  [method: string]: OperationObject;
};

type OperationObject = {
  requestBody?: {
    content?: ContentObject;
    [key: string]: any;
  };
  responses?: Record<string, { content?: ContentObject; [key: string]: any }>;
  parameters?: Array<{
    schema?: SchemaObject;
    [key: string]: any;
  }>;
  [key: string]: any;
};

type ContentObject = Record<string, MediaTypeObject>;

type MediaTypeObject = {
  schema?: SchemaObject;
  [key: string]: any;
};

type SchemaObject = {
  type?: string | string[];
  nullable?: boolean;
  oneOf?: SchemaObject[];
  anyOf?: SchemaObject[];
  allOf?: SchemaObject[];
  $ref?: string;
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  required?: string[];
  [key: string]: any;
};

class Schema {
  type?: string;
  nullable?: boolean;
  oneOf?: Schema[];
  anyOf?: Schema[];
  allOf?: Schema[];
  $ref?: string;
  properties?: Record<string, Schema>;
  items?: Schema;
  required?: string[];
  additionalProperties?: Schema;
  discriminator?: {
    propertyName: string;
    mapping?: Record<string, string>;
  };
  [key: string]: any;

  constructor(schema: Partial<SchemaObject>) {
    Object.assign(this, schema);

    if (Array.isArray(schema.type)) {
      this.handleTypeArray(schema.type);
    }

    if (schema.oneOf) {
      this.oneOf = schema.oneOf.map((entry) => new Schema(entry));
    }
    if (schema.anyOf) {
      this.anyOf = schema.anyOf.map((entry) => new Schema(entry));
    }
    if (schema.allOf) {
      this.allOf = schema.allOf.map((entry) => new Schema(entry));
    }
    if (schema.properties) {
      this.properties = {};
      for (const key in schema.properties) {
        this.properties[key] = new Schema(schema.properties[key]);
      }
    }
    if (schema.items) {
      this.items = new Schema(schema.items);
    }
    if (schema.additionalProperties) {
      this.additionalProperties = new Schema(schema.additionalProperties);
    }
  }

  // Handle `type` when provided as an array
  handleTypeArray(types: string[]) {
    if (types.includes("null")) {
      this.nullable = true;
      this.type = types.filter((type) => type !== "null")[0] || "object";
    } else {
      this.type = types[0];
    }
  }

  // Method to adjust the schema for OpenAPI 3.0.3 compatibility
  adjust(schemaMap: Record<string, Schema>) {
    this.removeUnsupportedProperties();
    this.handleConstAsEnum();
    this.handleNullType();
    this.handleAnyOfWithNull();
    this.handleOneOfWithNull();
    this.flattenIdenticalReferences(schemaMap);
    this.adjustNestedSchemas(schemaMap);
  }

  // Remove unsupported properties in OpenAPI 3.0.3
  removeUnsupportedProperties() {
    delete this.$schema;
    delete this.$id;
    delete this.$comment;
    delete this.unevaluatedProperties;
    delete this.patternProperties;
    delete this.contentMediaType;
    delete this.contentEncoding;
    delete this.examples; // Remove the `examples` property
  }

  // Handle `const` by converting it to `enum`
  handleConstAsEnum() {
    if (this.const !== undefined) {
      this.enum = [this.const];
      delete this.const;
    }
  }

  // 🔹 Convert `type: "null"` to `type: "object", nullable: true`
  handleNullType() {
    if (this.type === "null") {
      this.type = "object";
      this.nullable = true;
    }
  }

  // Handle `anyOf` containing `null` and a reference or another type
  handleAnyOfWithNull() {
    if (this.anyOf) {
      let hasNullType = false;
      let nonNullEntry: Schema | null = null;

      // Check for `null` type in `anyOf`
      this.anyOf.forEach((entry) => {
        if (entry.type === "null") {
          hasNullType = true;
        } else {
          nonNullEntry = entry;
        }
      });

      // If both `null` and another type are present, make the schema nullable and use `allOf` for reference
      if (hasNullType && nonNullEntry) {
        this.nullable = true;

        if ((nonNullEntry as Schema).$ref) {
          // Convert `anyOf` to `allOf` with the reference
          this.allOf = [{ $ref: (nonNullEntry as Schema).$ref } as Schema];
        } else {
          // Otherwise, retain all properties of the non-null entry
          Object.assign(this, nonNullEntry);
        }

        delete this.anyOf;
      }
    }
  }

  // Handle `oneOf` containing `null` and another type
  handleOneOfWithNull() {
    // Do not modify `oneOf` if a discriminator is present
    if (this.discriminator) {
      return;
    }

    if (this.oneOf) {
      let hasNullType = false;
      let nonNullEntry: Schema | null = null;

      // Iterate through the `oneOf` entries
      this.oneOf.forEach((entry) => {
        if (entry.type === "null") {
          hasNullType = true;
        } else {
          nonNullEntry = entry;
        }
      });

      // If both `null` and another type are present
      if (hasNullType && nonNullEntry) {
        // Set nullable to true
        this.nullable = true;

        // Retain all properties of the non-null entry (type, enum, description, etc.)
        for (const key in nonNullEntry as Schema) {
          if (key !== "type" && key !== "nullable") {
            (this as any)[key] = nonNullEntry[key];
          }
        }

        // Assign the type of the non-null entry
        this.type = (nonNullEntry as Schema).type;

        // If there's an enum, retain it
        if ((nonNullEntry as Schema).enum) {
          this.enum = (nonNullEntry as Schema).enum;
        }

        delete this.oneOf;
      }
    }
  }

  // Flatten `oneOf` or `anyOf` if all `$ref` point to the same primitive type
  flattenIdenticalReferences(schemaMap: Record<string, Schema>) {
    // Do not modify `oneOf` or `anyOf` if a discriminator is present
    if (this.discriminator) {
      return;
    }

    const keywords = ["oneOf", "anyOf"] as const;

    keywords.forEach((keyword) => {
      if (this[keyword]) {
        const entries = this[keyword]!;
        let primitiveType: string | null = null;
        let hasNullType = false;

        // Check each entry in `oneOf` or `anyOf`
        entries.forEach((entry) => {
          if (entry.$ref) {
            const refSchemaName = entry.$ref.split("/").pop()!;
            const refSchema = schemaMap[refSchemaName];

            if (refSchema) {
              if (typeof refSchema.type === "string") {
                if (!primitiveType) {
                  primitiveType = refSchema.type;
                } else if (primitiveType !== refSchema.type) {
                  primitiveType = null; // Different types found, cannot flatten
                }
              }
            }
          } else if (entry.type === "null") {
            hasNullType = true;
          } else if (typeof entry.type === "string") {
            if (!primitiveType) {
              primitiveType = entry.type;
            } else if (primitiveType !== entry.type) {
              primitiveType = null; // Different types found, cannot flatten
            }
          }
        });

        // If all references point to the same primitive type
        if (primitiveType) {
          this.type = primitiveType;
          if (hasNullType) {
            this.nullable = true;
          }
          delete this[keyword];
        }
      }
    });
  }

  // Adjust nested schemas recursively
  adjustNestedSchemas(schemaMap: Record<string, Schema>) {
    if (this.properties) {
      Object.values(this.properties).forEach((property) => {
        property.adjust(schemaMap);
      });
    }

    if (this.items) {
      this.items.adjust(schemaMap);
    }

    if (this.additionalProperties) {
      this.additionalProperties.adjust(schemaMap);
    }

    // Recursively adjust oneOf, anyOf, allOf entries
    const keywords = ["oneOf", "anyOf", "allOf"] as const;
    keywords.forEach((keyword) => {
      if (this[keyword]) {
        this[keyword] = this[keyword]!.map((entry) => {
          // Ensure entry is converted to a Schema instance before adjustment
          const schemaEntry =
            entry instanceof Schema ? entry : new Schema(entry);
          schemaEntry.adjust(schemaMap);
          return schemaEntry;
        });
      }
    });
  }
}

// Function to downconvert OpenAPI 3.1 to 3.0.3
export function downconvertOpenAPI31To30(spec: OpenAPISpec31): OpenAPISpec30 {
  const convertedSpec: OpenAPISpec30 = { ...spec, openapi: "3.0.1" };

  // Map to store schemas for resolving $ref types
  const schemaMap: Record<string, Schema> = convertedSpec.components?.schemas
    ? Object.fromEntries(
        Object.entries(convertedSpec.components.schemas).map(([key, value]) => [
          key,
          new Schema(value),
        ])
      )
    : {};

  // Adjust schema properties in components
  if (convertedSpec.components?.schemas) {
    for (const schemaName in convertedSpec.components.schemas) {
      const schema = schemaMap[schemaName];
      schema.adjust(schemaMap);
      convertedSpec.components.schemas[schemaName] = schema;
    }
  }

  // Adjust paths
  if (convertedSpec.paths) {
    for (const path in convertedSpec.paths) {
      const pathItem = convertedSpec.paths[path];
      for (const method in pathItem) {
        const operation = pathItem[method];

        // Handle requestBody content
        if (operation.requestBody?.content) {
          Object.values(operation.requestBody.content).forEach((mediaType) => {
            if (mediaType.schema) {
              const schema = new Schema(mediaType.schema);
              schema.adjust(schemaMap);
              mediaType.schema = schema;
            }
          });
        }

        // Handle response content
        if (operation.responses) {
          for (const response in operation.responses) {
            if (operation.responses[response]?.content) {
              Object.values(operation.responses[response].content).forEach(
                (mediaType) => {
                  if (mediaType.schema) {
                    const schema = new Schema(mediaType.schema);
                    schema.adjust(schemaMap);
                    mediaType.schema = schema;
                  }
                }
              );
            }
          }
        }

        // Handle parameters
        if (operation.parameters) {
          operation.parameters.forEach((parameter) => {
            if (parameter.schema) {
              const schema = new Schema(parameter.schema);
              schema.adjust(schemaMap);
              parameter.schema = schema;
            }
          });
        }
      }
    }
  }

  return convertedSpec;
}

import { promises as fs } from "fs";
import path from "path";
import YAML from "yamljs";

async function readYamlFile(filePath: string): Promise<object> {
  try {
    // Resolve the full path to ensure it works with relative paths
    const fullPath = path.resolve(filePath);

    // Read the YAML file asynchronously
    const fileContents = await fs.readFile(fullPath, "utf8");

    // Parse YAML into JSON
    const parsedData = YAML.parse(fileContents);

    return parsedData;
  } catch (err) {
    if (err && typeof err === "object" && "message" in err) {
      throw new Error(`Error reading or parsing YAML file: ${err.message}`);
    }
    throw err;
  }
}

async function writeJsonToFile(filePath: string, data: object): Promise<void> {
  try {
    // Resolve the full path to ensure it works with relative paths
    const fullPath = path.resolve(filePath);

    // Convert the data to a JSON string
    const jsonString = JSON.stringify(data, null, 2); // Pretty print with 2-space indentation

    // Write the JSON string to the specified file asynchronously
    await fs.writeFile(fullPath, jsonString, "utf8");
    console.log(`Successfully wrote to ${fullPath}`);
  } catch (err) {
    if (err && typeof err === "object" && "message" in err) {
      throw new Error(`Error writing JSON to file: ${err.message}`);
    }
    throw err;
  }
}

readYamlFile("./dist/platform.yml")
  .then((r) => downconvertOpenAPI31To30(r as any))
  .then((spec) => writeJsonToFile("./dist/platform-3.0.3.json", spec));
