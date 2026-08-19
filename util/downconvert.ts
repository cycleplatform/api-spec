type OpenAPISpec31 = {
  openapi: "3.1.0";
  components?: ComponentsObject;
  paths?: Record<string, PathItemObject>;
  webhooks?: Record<string, PathItemObject>;
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
  parameters?: Record<string, any>;
  headers?: Record<string, any>;
  requestBodies?: Record<string, any>;
  responses?: Record<string, any>;
  callbacks?: Record<string, any>;
  pathItems?: Record<string, PathItemObject>;
  [key: string]: any;
};

type PathItemObject = {
  [method: string]: any;
};

type ContentObject = Record<string, MediaTypeObject>;

type MediaTypeObject = {
  schema?: SchemaObject;
  encoding?: Record<string, any>;
  [key: string]: any;
};

type SchemaObject = {
  type?: string | string[];
  nullable?: boolean;
  oneOf?: SchemaObject[];
  anyOf?: SchemaObject[];
  allOf?: SchemaObject[];
  not?: SchemaObject;
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
  not?: Schema;
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
    if (schema.not) {
      this.not = new Schema(schema.not);
    }
    if (schema.properties) {
      this.properties = {};
      for (const key in schema.properties) {
        this.properties[key] = new Schema(schema.properties[key]);
      }
    }
    // `items` is a single Schema Object in 3.0/3.1. Guard against the legacy
    // tuple form (an array) so we never call `new Schema([...])`.
    if (schema.items && !Array.isArray(schema.items)) {
      this.items = new Schema(schema.items);
    }
    if (
        schema.additionalProperties &&
        typeof schema.additionalProperties === "object"
    ) {
      this.additionalProperties = new Schema(schema.additionalProperties);
    }
  }

  // Handle `type` when provided as an array
  handleTypeArray(types: string[]) {
    if (types.includes("null")) {
      this.nullable = true;

      const nonNull = types.filter((type) => type !== "null");

      // A single non-null type downconverts cleanly. More than one non-null
      // type has no faithful OpenAPI 3.0 scalar `type`, so keep the first and
      // warn rather than silently dropping the rest.
      if (nonNull.length > 1) {
        console.warn(
            `[downconvert] multi-type array ${JSON.stringify(
                types
            )} cannot be represented in 3.0; keeping "${nonNull[0]}" only`
        );
      }

      this.type = nonNull[0] || "object";
    } else {
      if (types.length > 1) {
        console.warn(
            `[downconvert] multi-type array ${JSON.stringify(
                types
            )} cannot be represented in 3.0; keeping "${types[0]}" only`
        );
      }

      this.type = types[0];
    }
  }

  // Adjust the schema (and everything nested in it) for OpenAPI 3.0.1.
  adjust(schemaMap: Record<string, Schema>) {
    this.removeUnsupportedProperties();
    this.deduplicateRequired();
    this.handleConstAsEnum();
    this.handleNullType();
    this.collapseNullUnion("anyOf");
    this.collapseNullUnion("oneOf");
    this.flattenIdenticalReferences(schemaMap);
    this.normalizeRefSiblings();
    this.adjustNestedSchemas(schemaMap);
  }

  // Remove keywords that are not valid in OpenAPI 3.0.1
  removeUnsupportedProperties() {
    // `definition` is not an OpenAPI keyword. The source spec uses it in a few
    // places as a stray doc string (a typo for `description`). Promote it so the
    // text is preserved and the node stays valid 3.0, rather than dropping it.
    if (typeof this.definition === "string") {
      if (this.description === undefined) {
        this.description = this.definition;
      }
      delete this.definition;
    }

    delete this.$schema;
    delete this.$id;
    delete this.$comment;
    delete this.unevaluatedProperties;
    delete this.unevaluatedItems;
    delete this.patternProperties;
    delete this.contentMediaType;
    delete this.contentEncoding;
    delete this.examples; // 3.0 uses singular `example`
  }

  // A `required` array must not contain duplicates in strict 3.0. Requiring a
  // property twice is equivalent to requiring it once, so de-duping is lossless.
  deduplicateRequired() {
    if (Array.isArray(this.required)) {
      this.required = Array.from(new Set(this.required));
    }
  }

  // Handle `const` by converting it to a single-value `enum`
  handleConstAsEnum() {
    if (this.const !== undefined) {
      this.enum = [this.const];
      delete this.const;
    }
  }

  // Convert a standalone `type: "null"` to `type: "object", nullable: true`
  handleNullType() {
    if (this.type === "null") {
      this.type = "object";
      this.nullable = true;
    }
  }

  // Collapse an `oneOf`/`anyOf` union that contains a `type: "null"` member
  // into an OpenAPI 3.0 nullable form.
  //
  //   - no null member                 -> leave untouched (flatten may handle it)
  //   - discriminated union + null      -> keep the branch list, only drop null
  //   - >= 2 real branches + null       -> preserve the union, only drop null
  //   - exactly 1 real branch ($ref)    -> allOf-wrap the ref + nullable
  //                                        (a $ref cannot carry a nullable sibling in 3.0)
  //   - exactly 1 real branch (inline)  -> hoist the branch onto this schema + nullable
  //   - 0 real branches                 -> just a nullable, untyped schema
  collapseNullUnion(keyword: "oneOf" | "anyOf") {
    const members = this[keyword] as Schema[] | undefined;
    if (!members) {
      return;
    }

    const hasNull = members.some((member) => member.type === "null");
    if (!hasNull) {
      return;
    }

    const nonNull = members.filter((member) => member.type !== "null");
    this.nullable = true;

    // Discriminated unions must keep their full branch list for the
    // discriminator to stay valid; only strip the null member.
    if (this.discriminator) {
      this[keyword] = nonNull;
      return;
    }

    // Two or more real branches: preserve the union, drop only the null member.
    if (nonNull.length >= 2) {
      this[keyword] = nonNull;
      return;
    }

    // Exactly one (or zero) real branch: collapse it into this schema.
    const only = nonNull[0];
    delete this[keyword];

    if (only && only.$ref) {
      // A `$ref` alongside `nullable` is ignored by 3.0 tooling, so express the
      // reference through `allOf`, where the sibling `nullable` is honored.
      this.allOf = [{ $ref: only.$ref } as Schema];
      return;
    }

    if (only) {
      // Retain the non-null branch's members (properties, required, enum,
      // description, etc.), then set the type explicitly.
      for (const key in only) {
        if (key !== "type" && key !== "nullable") {
          (this as any)[key] = only[key];
        }
      }

      this.type = only.type;

      if (only.enum) {
        this.enum = only.enum;
      }
    }
  }

  // Flatten `oneOf`/`anyOf` only when every branch resolves to the *same
  // scalar* type. Object/array branches (or refs to them) are real, distinct
  // schemas and must never be collapsed to a bare `type`, or the union is lost.
  flattenIdenticalReferences(schemaMap: Record<string, Schema>) {
    if (this.discriminator) {
      return;
    }

    const SCALAR_TYPES = new Set(["string", "number", "integer", "boolean"]);
    const keywords = ["oneOf", "anyOf"] as const;

    keywords.forEach((keyword) => {
      if (!this[keyword]) {
        return;
      }

      const entries = this[keyword]!;
      let sharedType: string | null = null;
      let hasNullType = false;
      let canFlatten = true;

      entries.forEach((entry) => {
        if (entry.type === "null") {
          hasNullType = true;
          return;
        }

        let entryType: string | undefined;
        if (entry.$ref) {
          const refSchemaName = entry.$ref.split("/").pop()!;
          const refSchema = schemaMap[refSchemaName];
          if (refSchema && typeof refSchema.type === "string") {
            entryType = refSchema.type;
          }
        } else if (typeof entry.type === "string") {
          entryType = entry.type;
        }

        // Non-scalar, unresolved, or typeless branch -> keep the union intact.
        if (!entryType || !SCALAR_TYPES.has(entryType)) {
          canFlatten = false;
          return;
        }

        if (sharedType === null) {
          sharedType = entryType;
        } else if (sharedType !== entryType) {
          canFlatten = false;
        }
      });

      if (canFlatten && sharedType) {
        this.type = sharedType;
        if (hasNullType) {
          this.nullable = true;
        }
        delete this[keyword];
      }
    });
  }

  // In OpenAPI 3.0 a `$ref` may not carry sibling keywords (unlike 3.1). When a
  // node has both a `$ref` and siblings (description, minLength, etc.), move the
  // reference into an `allOf` so the siblings are retained and the node is valid
  // 3.0. A bare `{ $ref }` is left untouched.
  normalizeRefSiblings() {
    if (!this.$ref) {
      return;
    }

    const siblingKeys = Object.keys(this).filter(
        (key) => key !== "$ref" && this[key] !== undefined
    );
    if (siblingKeys.length === 0) {
      return;
    }

    const ref = this.$ref;
    const existingAllOf = Array.isArray(this.allOf) ? this.allOf : [];
    delete this.$ref;
    delete this.allOf;
    this.allOf = [{ $ref: ref } as Schema, ...existingAllOf];
  }

  // Recurse into every sub-schema position
  adjustNestedSchemas(schemaMap: Record<string, Schema>) {
    if (this.properties) {
      Object.values(this.properties).forEach((property) => {
        property.adjust(schemaMap);
      });
    }

    if (this.items) {
      this.items.adjust(schemaMap);
    }

    if (this.additionalProperties instanceof Schema) {
      this.additionalProperties.adjust(schemaMap);
    }

    if (this.not) {
      this.not.adjust(schemaMap);
    }

    const keywords = ["oneOf", "anyOf", "allOf"] as const;
    keywords.forEach((keyword) => {
      if (this[keyword]) {
        this[keyword] = this[keyword]!.map((entry) => {
          const schemaEntry =
              entry instanceof Schema ? entry : new Schema(entry);
          schemaEntry.adjust(schemaMap);
          return schemaEntry;
        });
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Position-aware walk: normalize a Schema Object everywhere one can appear.
// ---------------------------------------------------------------------------

const HTTP_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
] as const;

function isObject(value: any): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeSchemaAt(
    container: any,
    key: string,
    schemaMap: Record<string, Schema>
) {
  const raw = container[key];
  if (isObject(raw)) {
    const schema = raw instanceof Schema ? raw : new Schema(raw);
    schema.adjust(schemaMap);
    container[key] = schema;
  }
}

function walkContent(content: any, schemaMap: Record<string, Schema>) {
  if (!isObject(content)) {
    return;
  }

  for (const mediaType of Object.values<any>(content)) {
    if (!isObject(mediaType)) {
      continue;
    }

    if (mediaType.schema) {
      normalizeSchemaAt(mediaType, "schema", schemaMap);
    }

    if (isObject(mediaType.encoding)) {
      for (const encoding of Object.values<any>(mediaType.encoding)) {
        if (isObject(encoding) && encoding.headers) {
          walkHeaders(encoding.headers, schemaMap);
        }
      }
    }
  }
}

function walkHeaders(headers: any, schemaMap: Record<string, Schema>) {
  if (!isObject(headers)) {
    return;
  }

  for (const header of Object.values<any>(headers)) {
    if (!isObject(header)) {
      continue;
    }

    if (header.schema) {
      normalizeSchemaAt(header, "schema", schemaMap);
    }

    if (header.content) {
      walkContent(header.content, schemaMap);
    }
  }
}

function walkParameters(parameters: any, schemaMap: Record<string, Schema>) {
  if (!parameters) {
    return;
  }

  const list = Array.isArray(parameters)
      ? parameters
      : Object.values<any>(parameters);

  for (const parameter of list) {
    if (!isObject(parameter)) {
      continue;
    }

    if (parameter.schema) {
      normalizeSchemaAt(parameter, "schema", schemaMap);
    }

    if (parameter.content) {
      walkContent(parameter.content, schemaMap);
    }
  }
}

function walkResponses(responses: any, schemaMap: Record<string, Schema>) {
  if (!isObject(responses)) {
    return;
  }

  for (const response of Object.values<any>(responses)) {
    if (!isObject(response)) {
      continue;
    }

    if (response.content) {
      walkContent(response.content, schemaMap);
    }

    if (response.headers) {
      walkHeaders(response.headers, schemaMap);
    }
  }
}

function walkRequestBody(requestBody: any, schemaMap: Record<string, Schema>) {
  if (isObject(requestBody) && requestBody.content) {
    walkContent(requestBody.content, schemaMap);
  }
}

function walkCallbacks(callbacks: any, schemaMap: Record<string, Schema>) {
  if (!isObject(callbacks)) {
    return;
  }

  for (const callback of Object.values<any>(callbacks)) {
    if (!isObject(callback)) {
      continue;
    }

    for (const pathItem of Object.values<any>(callback)) {
      walkPathItem(pathItem, schemaMap);
    }
  }
}

function walkOperation(operation: any, schemaMap: Record<string, Schema>) {
  if (!isObject(operation)) {
    return;
  }

  if (operation.parameters) {
    walkParameters(operation.parameters, schemaMap);
  }

  if (operation.requestBody) {
    walkRequestBody(operation.requestBody, schemaMap);
  }

  if (operation.responses) {
    walkResponses(operation.responses, schemaMap);
  }

  if (operation.callbacks) {
    walkCallbacks(operation.callbacks, schemaMap);
  }
}

function walkPathItem(pathItem: any, schemaMap: Record<string, Schema>) {
  if (!isObject(pathItem)) {
    return;
  }

  if (pathItem.parameters) {
    walkParameters(pathItem.parameters, schemaMap);
  }

  for (const method of HTTP_METHODS) {
    if (pathItem[method]) {
      walkOperation(pathItem[method], schemaMap);
    }
  }
}

// ---------------------------------------------------------------------------
// Hoist complex inline oneOf/anyOf members into named components.
//
// oapi-codegen auto-names an *inline* union member `<Path><index>` (e.g.
// `StackSpecContainerConfigRuntimeCapabilities0`). With the pervasive
// `oneOf: [<literal>, { $ref: StackVariable }]` idiom, two different inline
// members can reduce to the same generated name with different definitions,
// and codegen aborts: "duplicate typename ... can't auto-rename". A `$ref`
// member is instead named after its component, which we control and keep
// globally unique. Moving each complex inline member into its own component
// removes the entire collision class while preserving the union (unlike
// collapsing it to a bare `type`, which silently discards the branches).
// ---------------------------------------------------------------------------

const UNION_SEPARATORS = new Set("-#@!$&=.+:;_~ (){}[]".split(""));

// Mirrors oapi-codegen's ToCamelCase over an underscore-joined path, so the
// hoisted component name matches the name codegen would otherwise have derived
// (just promoted to a real, unique component).
function pascalConcat(parts: string[]): string {
  const joined = parts.join("_");
  let result = "";
  let capitalizeNext = true;
  for (const ch of joined) {
    if (ch >= "A" && ch <= "Z") {
      result += ch;
    } else if (ch >= "0" && ch <= "9") {
      result += ch;
    } else if (ch >= "a" && ch <= "z") {
      result += capitalizeNext ? ch.toUpperCase() : ch;
    }
    capitalizeNext = UNION_SEPARATORS.has(ch);
  }
  return result;
}

// A member gets its own generated Go type only when it is a non-$ref, non-null
// schema that is an object, array, enum, or nested union. Scalars are rendered
// inline by oapi-codegen and never collide, so they are left alone.
function memberGeneratesNamedType(member: any): boolean {
  if (!isObject(member) || member.$ref) {
    return false;
  }
  if (member.type === "null") {
    return false;
  }
  if (member.oneOf || member.anyOf) {
    return true;
  }
  if (member.enum) {
    return true;
  }
  if (member.type === "array") {
    return true;
  }
  if (member.type === "object" && (member.properties || member.additionalProperties)) {
    return true;
  }
  return false;
}

function makeUniqueComponentName(base: string, used: Set<string>): string {
  const safeBase = base.length > 0 ? base : "InlineType";
  let candidate = safeBase;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${safeBase}_${counter}`;
    counter += 1;
  }
  used.add(candidate);
  return candidate;
}

function hoistInSchema(
    node: any,
    path: string[],
    schemas: Record<string, any>,
    used: Set<string>
) {
  if (!isObject(node)) {
    return;
  }

  const unionKeywords = ["oneOf", "anyOf"] as const;
  for (const keyword of unionKeywords) {
    const members = node[keyword];
    if (Array.isArray(members)) {
      for (let index = 0; index < members.length; index += 1) {
        const member = members[index];
        const memberPath = path.concat(String(index));

        // Recurse first so nested inline members inside this member are hoisted
        // (and turned into $refs) before the member itself is moved.
        hoistInSchema(member, memberPath, schemas, used);

        if (memberGeneratesNamedType(member)) {
          const name = makeUniqueComponentName(pascalConcat(memberPath), used);
          schemas[name] = member;
          members[index] = { $ref: `#/components/schemas/${name}` };
        }
      }
    }
  }

  if (isObject(node.properties)) {
    for (const propertyName in node.properties) {
      hoistInSchema(
          node.properties[propertyName],
          path.concat(propertyName),
          schemas,
          used
      );
    }
  }

  if (isObject(node.items)) {
    hoistInSchema(node.items, path.concat("Item"), schemas, used);
  }

  if (node.additionalProperties instanceof Schema) {
    hoistInSchema(
        node.additionalProperties,
        path.concat("AdditionalProperties"),
        schemas,
        used
    );
  }

  if (isObject(node.not)) {
    hoistInSchema(node.not, path.concat("Not"), schemas, used);
  }

  if (Array.isArray(node.allOf)) {
    for (let index = 0; index < node.allOf.length; index += 1) {
      // allOf members share the owner's naming path in oapi-codegen.
      hoistInSchema(node.allOf[index], path, schemas, used);
    }
  }
}

// Walk every component schema and hoist its complex inline union members.
function hoistInlineUnionMembers(spec: OpenAPISpec30) {
  const components = spec.components;
  if (!components || !isObject(components.schemas)) {
    return;
  }

  const schemas = components.schemas as Record<string, any>;
  const used = new Set<string>(Object.keys(schemas));

  // Snapshot names first: hoisting adds new components during iteration, and
  // those already contain only $ref members, so they need no further walk.
  const originalNames = Object.keys(schemas);
  for (const name of originalNames) {
    hoistInSchema(schemas[name], [name], schemas, used);
  }
}

// Downconvert an OpenAPI 3.1 document to 3.0.1
export function downconvertOpenAPI31To30(spec: OpenAPISpec31): OpenAPISpec30 {
  const convertedSpec: OpenAPISpec30 = { ...spec, openapi: "3.0.1" };

  // Build a name->Schema map so `$ref`s can be resolved during flattening.
  const schemaMap: Record<string, Schema> = convertedSpec.components?.schemas
      ? Object.fromEntries(
          Object.entries(convertedSpec.components.schemas).map(([key, value]) => [
            key,
            new Schema(value),
          ])
      )
      : {};

  const components = convertedSpec.components;
  if (components) {
    // components.schemas
    if (components.schemas) {
      for (const schemaName in components.schemas) {
        const schema = schemaMap[schemaName];
        schema.adjust(schemaMap);
        components.schemas[schemaName] = schema;
      }
    }

    // Reusable components that can carry Schema Objects.
    if (components.parameters) {
      walkParameters(components.parameters, schemaMap);
    }
    if (components.headers) {
      walkHeaders(components.headers, schemaMap);
    }
    if (components.requestBodies) {
      for (const requestBody of Object.values<any>(components.requestBodies)) {
        walkRequestBody(requestBody, schemaMap);
      }
    }
    if (components.responses) {
      walkResponses(components.responses, schemaMap);
    }
    if (components.callbacks) {
      walkCallbacks(components.callbacks, schemaMap);
    }
    if (components.pathItems) {
      for (const pathItem of Object.values<any>(components.pathItems)) {
        walkPathItem(pathItem, schemaMap);
      }
    }
  }

  // paths
  if (convertedSpec.paths) {
    for (const path in convertedSpec.paths) {
      walkPathItem(convertedSpec.paths[path], schemaMap);
    }
  }

  // webhooks are a 3.1-only root construct. Normalize any schemas they carry
  // (in case they are consumed elsewhere), then drop the key so the emitted
  // document is valid 3.0.1.
  if (isObject((convertedSpec as any).webhooks)) {
    for (const pathItem of Object.values<any>((convertedSpec as any).webhooks)) {
      walkPathItem(pathItem, schemaMap);
    }
    delete (convertedSpec as any).webhooks;
  }

  // Final pass: hoist complex inline oneOf/anyOf members into named components
  // so oapi-codegen never auto-generates colliding `<Path><index>` type names.
  hoistInlineUnionMembers(convertedSpec);

  return convertedSpec;
}

import { promises as fs } from "fs";
import path from "path";
import YAML from "yamljs";

async function readYamlFile(filePath: string): Promise<object> {
  const fullPath = path.resolve(filePath);
  const fileContents = await fs.readFile(fullPath, "utf8");
  return YAML.parse(fileContents);
}

async function writeJsonToFile(filePath: string, data: object): Promise<void> {
  const fullPath = path.resolve(filePath);
  const jsonString = JSON.stringify(data, null, 2);
  await fs.writeFile(fullPath, jsonString, "utf8");
  console.log(`Successfully wrote to ${fullPath}`);
}

// Convert every bundled API that exists. Each `dist/<api>.yml` (produced by the
// `build:*` scripts) becomes `dist/<api>-3.0.3.json`.
const APIS = ["platform", "internal", "scheduler", "ial"];

async function main() {
  for (const api of APIS) {
    const input = `./dist/${api}.yml`;

    try {
      await fs.access(input);
    } catch {
      console.warn(`[downconvert] skipping ${api}: ${input} not found`);
      continue;
    }

    const spec = await readYamlFile(input);
    const converted = downconvertOpenAPI31To30(spec as any);
    await writeJsonToFile(`./dist/${api}-3.0.3.json`, converted);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});