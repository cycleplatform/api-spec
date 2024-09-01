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

function resolveRefType(ref: string, schemaMap: Record<string, SchemaObject>): string | undefined {
    const refKey = ref.replace(/^#\/components\/schemas\//, '');
    const referencedSchema = schemaMap[refKey];
    if (referencedSchema && referencedSchema.type) {
      return referencedSchema.type;
    }
    return undefined;
  }
  
  function adjustSchema(schema: SchemaObject, schemaMap: Record<string, SchemaObject>): void {
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
  
    // Handle 'type' as an array including 'null'
    if (Array.isArray(schema.type)) {
      if (schema.type.includes('null')) {
        const nonNullTypes = schema.type.filter(t => t !== 'null');
        if (nonNullTypes.length === 1) {
          schema.type = nonNullTypes[0];
          schema.nullable = true;
        } else {
          schema.anyOf = nonNullTypes.map(type => ({ type }));
          delete schema.type;
        }
      } else if (schema.type.length === 1) {
        schema.type = schema.type[0]; // Reduce single-type array to a single value
      }
    } else if (schema.type === 'null') {
      schema.type = 'object';
      schema.nullable = true;
    }
  
    // Remove default if null type is removed
    if (schema.default === null && !schema.nullable && schema.type !== 'null' && !schema.anyOf?.some(entry => entry.type === 'null')) {
      delete schema.default;
    }
  
    // Handle merging of anyOf/oneOf with $ref and nullable object/type
    ['anyOf', 'oneOf'].forEach(keyword => {
      if (schema[keyword]) {
        let hasRef = false;
        let refType: string | undefined;
  
        const filteredSchemas = schema[keyword].filter(entry => {
          if (entry.$ref) {
            hasRef = true;
            refType = resolveRefType(entry.$ref, schemaMap) || refType;
            return true;
          } else if (entry.type === 'null') {
            return false; // Ignore null type, do not include in anyOf/oneOf
          }
          return true;
        });
  
        if (filteredSchemas.length === 1) {
          // If there's only one schema left, use it directly
          Object.assign(schema, filteredSchemas[0]);
          delete schema[keyword];
        } else if (filteredSchemas.length > 0) {
          schema[keyword] = filteredSchemas;
          // Ensure type isn't added unnecessarily
          if (keyword === 'items' && (schema.oneOf || schema.anyOf)) {
            delete schema.type;
          }
        } else {
          delete schema[keyword];
        }
      }
    });
  
    // Ensure type is not reintroduced as an array
    if (Array.isArray(schema.type)) {
      schema.type = schema.type.length === 1 ? schema.type[0] : schema.type;
    }
  
    // Ensure no unnecessary 'type' in items with oneOf/anyOf
    if (schema.items && (schema.items.oneOf || schema.items.anyOf)) {
      delete schema.items.type;
    }
  
    // Convert examples array to single example
    if (schema.examples && Array.isArray(schema.examples)) {
      schema.example = schema.examples.join('\n');
      delete schema.examples;
    }
  
    // Recursively adjust nested schemas
    if (schema.properties) {
      Object.values(schema.properties).forEach(propSchema => adjustSchema(propSchema, schemaMap));
    }
  
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      adjustSchema(schema.additionalProperties, schemaMap);
    }
  
    if (schema.items && typeof schema.items === 'object') {
      adjustSchema(schema.items, schemaMap);
    }
  
    // Handle `allOf` schemas
    if (schema.allOf) {
      schema.allOf.forEach(entry => adjustSchema(entry, schemaMap));
    }
  }
  
  function adjustContent(content: ContentObject, schemaMap: Record<string, SchemaObject>): void {
    for (const contentType in content) {
      const mediaTypeObject = content[contentType];
      if (mediaTypeObject.schema) {
        adjustSchema(mediaTypeObject.schema, schemaMap);
      }
      if (mediaTypeObject.examples && Array.isArray(mediaTypeObject.examples)) {
        mediaTypeObject.example = mediaTypeObject.examples.join('\n');
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
