type SchemaObject = {
  type?: string | string[];
  nullable?: boolean;
  oneOf?: SchemaObject[];
  anyOf?: SchemaObject[];
  allOf?: SchemaObject[];
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  [key: string]: any;
};

type MediaTypeObject = {
  schema?: SchemaObject;
  [key: string]: any;
};

type ContentObject = Record<string, MediaTypeObject>;

type OperationObject = {
  requestBody?: {
    content?: ContentObject;
    [key: string]: any;
  };
  responses?: Record<string, { content?: ContentObject; [key: string]: any }>;
  [key: string]: any;
};

type PathItemObject = {
  [method: string]: OperationObject;
};

type ComponentsObject = {
  schemas?: Record<string, SchemaObject>;
  [key: string]: any;
};

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

export function downconvertOpenAPI31To30(spec: OpenAPISpec31): OpenAPISpec30 {
  const convertedSpec: OpenAPISpec30 = { ...spec, openapi: "3.0.1" };

  // Map to store schemas for resolving $ref types
  const schemaMap: Record<string, SchemaObject> =
    convertedSpec.components?.schemas || {};

  // Adjust schema properties
  if (convertedSpec.components?.schemas) {
    for (const schemaName in convertedSpec.components.schemas) {
      const schema = convertedSpec.components.schemas[schemaName];
      adjustSchema(schema, schemaMap);
    }
  }

  // Remove or adjust unsupported features
  if (convertedSpec.webhooks) {
    delete convertedSpec.webhooks; // Webhooks are not supported in OpenAPI 3.0.1
  }

  // Adjust paths
  if (convertedSpec.paths) {
    for (const path in convertedSpec.paths) {
      const pathItem = convertedSpec.paths[path];
      for (const method in pathItem) {
        const operation = pathItem[method];
        if (operation.requestBody?.content) {
          adjustContent(operation.requestBody.content, schemaMap);
        }
        if (operation.responses) {
          for (const response in operation.responses) {
            if (operation.responses[response]?.content) {
              adjustContent(operation.responses[response].content!, schemaMap);
            }
          }
        }
      }
    }
  }

  return convertedSpec;
}

function adjustSchema(
  schema: SchemaObject,
  schemaMap: Record<string, SchemaObject>
): void {
  // Remove unsupported properties
  delete schema.$schema;
  delete schema.$id;
  delete schema.$comment;
  delete schema.unevaluatedProperties;
  delete schema.patternProperties;
  delete schema.contentMediaType;
  delete schema.contentEncoding;

  // Handle 'const' by converting it to 'enum'
  if (schema.const !== undefined) {
    schema.enum = [schema.const];
    delete schema.const;
  }

  // Handle type arrays that include 'null'
  if (Array.isArray(schema.type) && schema.type.includes("null")) {
    const nonNullTypes = schema.type.filter((t) => t !== "null");
    if (nonNullTypes.length === 1) {
      schema.type = nonNullTypes[0];
      schema.nullable = true;
    } else if (nonNullTypes.length > 1) {
      schema.anyOf = nonNullTypes.map((type) => ({ type }));
      schema.anyOf.push({ type: "null" });
      delete schema.type;
    }
  } else if (schema.type === "null") {
    schema.type = "object"; // Default type if only 'null' is specified
    schema.nullable = true;
  }

  // Recursively handle `oneOf` or `anyOf` and ensure proper type conversion
  ["oneOf", "anyOf"].forEach((keyword) => {
    if (schema[keyword]) {
      let refEntry: SchemaObject | null = null;
      let hasNullType = false;

      schema[keyword] = schema[keyword]!.map((entry): SchemaObject => {
        if (entry.$ref) {
          refEntry = entry; // Keep track of the $ref entry
        } else if (entry.type === "null") {
          hasNullType = true; // Keep track of null type entries
          return null; // Mark for removal
        }

        // Recursively adjust nested schemas in oneOf/anyOf
        adjustSchema(entry, schemaMap);

        return entry;
      }).filter((entry): entry is SchemaObject => entry !== null);

      // If we have a $ref and a `null` type, merge them into a single nullable reference
      if (refEntry && hasNullType) {
        const refSchemaName = refEntry.$ref.split("/").pop()!;
        const refSchema = schemaMap[refSchemaName];

        // Convert into a single schema with $ref, nullable, and type
        schema.$ref = refEntry.$ref;
        schema.nullable = true;

        // Extract type from the referenced schema if available
        if (refSchema && refSchema.type) {
          schema.type = refSchema.type;
        }

        delete schema[keyword]; // Remove `oneOf` or `anyOf` since it's been merged
      }

      // If only one schema remains after adjustments, merge it back into the parent
      if (schema[keyword] && schema[keyword].length === 1) {
        const singleSchema = schema[keyword][0];
        delete schema[keyword];
        Object.assign(schema, singleSchema);
      }
    }
  });

  // Recursively adjust nested schemas in properties, additionalProperties, items, allOf
  if (schema.properties) {
    Object.values(schema.properties).forEach((propSchema) =>
      adjustSchema(propSchema, schemaMap)
    );
  }

  if (
    schema.additionalProperties &&
    typeof schema.additionalProperties === "object"
  ) {
    adjustSchema(schema.additionalProperties, schemaMap);
  }

  if (schema.items && typeof schema.items === "object") {
    adjustSchema(schema.items, schemaMap);
  }

  if (schema.allOf) {
    schema.allOf.forEach((entry) => adjustSchema(entry, schemaMap));
  }

  // Convert examples array to single example
  if (schema.examples && Array.isArray(schema.examples)) {
    schema.example = schema.examples.join("\n");
    delete schema.examples;
  }

  // Ensure no type is an array
  if (Array.isArray(schema.type)) {
    if (schema.type.length === 1) {
      schema.type = schema.type[0]; // If there's only one type, convert it to a string
    } else {
      schema.anyOf = schema.type.map((type) => ({ type }));
      delete schema.type;
    }
  }
}

function adjustContent(
  content: ContentObject,
  schemaMap: Record<string, SchemaObject>
): void {
  for (const contentType in content) {
    const mediaTypeObject = content[contentType];
    if (mediaTypeObject.schema) {
      adjustSchema(mediaTypeObject.schema, schemaMap);
    }
    if (mediaTypeObject.examples && Array.isArray(mediaTypeObject.examples)) {
      mediaTypeObject.example = mediaTypeObject.examples.join("\n");
      delete mediaTypeObject.examples;
    }
  }
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
    throw new Error(`Error reading or parsing YAML file: ${err.message}`);
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
    throw new Error(`Error writing JSON to file: ${err.message}`);
  }
}

readYamlFile("./dist/platform.yml")
  .then((r) => downconvertOpenAPI31To30(r as any))
  .then((spec) => writeJsonToFile("./dist/platform-3.0.3.json", spec));

// downconvertOpenAPI31To30()
