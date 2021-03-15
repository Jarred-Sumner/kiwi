import { Schema, Definition, Field, DefinitionKind } from "./schema";
import { error, quote } from "./util";

export let nativeTypes = [
  "bool",
  "byte",
  "float",
  "int",
  "uint8",
  "uint16",
  "uint32",
  "int8",
  "int16",
  "lowp",
  "int32",
  "float32",
  "string",
  "uint",
  "discriminator",
  "alphanumeric",
];

export let nativeTypeMap = {
  bool: 1,
  byte: 1,
  float: 1,
  int: 1,
  uint8: 1,
  uint16: 1,
  uint32: 1,
  int8: 1,
  int16: 1,
  int32: 1,
  float32: 1,
  string: 1,
  uint: 1,
  discriminator: 1,
  alphanumeric: 1,
};

// These are special names on the object returned by compileSchema()
export let reservedNames = ["ByteBuffer", "package", "Allocator"];

let regex = /((?:-|\b)\d+\b|[=\:;{}]|\[\]|\[deprecated\]|\[!\]|\b[A-Za-z_][A-Za-z0-9_]*\b|"|-|\&|\||\/\/.*|\s+)/g;
let identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
let path = /^([-\_\.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@])*$/;
let whitespace = /^\/\/.*|\s+$/;
let equals = /^=$/;
let endOfFile = /^$/;
let semicolon = /^;$/;
let integer = /^-?\d+$/;
let leftBrace = /^\{$/;
let rightBrace = /^\}$/;
let arrayToken = /^\[\]$/;
let enumKeyword = /^enum$/;
let smolKeyword = /^smol$/;
let quoteToken = /^"$/;
let serializerKeyword = /^from$/;
let colon = /^:$/;
let packageKeyword = /^package$/;
let pick = /^pick$/;
let entityKeyword = /^entity$/;
let structKeyword = /^struct$/;
let aliasKeyword = /^alias$/;
let unionKeyword = /^union$/;
let messageKeyword = /^message$/;
let deprecatedToken = /^\[deprecated\]$/;
let unionOrToken = /^\|$/;
let extendsToken = /^&$/;
let requiredToken = /^\[!\]$/;

interface Pick {
  from: Token;
  to: Token;
  fieldNames: string[];
}

interface Token {
  text: string;
  line: number;
  column: number;
}

function tokenize(text: string): Token[] {
  let parts = text.split(regex);
  let tokens = [];
  let column = 0;
  let line = 0;

  for (let i = 0; i < parts.length; i++) {
    let part = parts[i];

    // Keep non-whitespace tokens
    if (i & 1) {
      if (!whitespace.test(part)) {
        tokens.push({
          text: part,
          line: line + 1,
          column: column + 1,
        });
      }
    }

    // Detect syntax errors
    else if (part !== "") {
      error("Syntax error " + quote(part), line + 1, column + 1);
    }

    // Keep track of the line and column counts
    let lines = part.split("\n");
    if (lines.length > 1) column = 0;
    line += lines.length - 1;
    column += lines[lines.length - 1].length;
  }

  // End-of-file token
  tokens.push({
    text: "",
    line: line,
    column: column,
  });

  return tokens;
}

function parse(tokens: Token[]): Schema {
  function current(): Token {
    return tokens[index];
  }

  function eat(test: RegExp): boolean {
    if (test.test(current().text)) {
      index++;
      return true;
    }
    return false;
  }

  function expect(test: RegExp, expected: string): void {
    if (!eat(test)) {
      let token = current();
      error(
        "Expected " + expected + " but found " + quote(token.text),
        token.line,
        token.column
      );
    }
  }

  function unexpectedToken(): never {
    let token = current();
    error("Unexpected token " + quote(token.text), token.line, token.column);
  }

  let definitions: Definition[] = [];
  let packageText = null;
  let index = 0;
  let picks: { [key: string]: Pick } = {};

  if (eat(packageKeyword)) {
    packageText = current().text;
    expect(identifier, "identifier");
    expect(semicolon, '";"');
  }
  let serializerPath;

  while (index < tokens.length && !eat(endOfFile)) {
    let fields: Field[] = [];
    let extensions: string[];
    let kind: DefinitionKind;

    if (eat(enumKeyword)) kind = "ENUM";
    else if (eat(smolKeyword)) kind = "SMOL";
    else if (eat(pick)) kind = "PICK";
    else if (eat(structKeyword)) kind = "STRUCT";
    else if (eat(messageKeyword)) kind = "MESSAGE";
    else if (eat(entityKeyword)) kind = "ENTITY";
    else if (eat(unionKeyword)) kind = "UNION";
    else if (eat(aliasKeyword)) kind = "ALIAS";
    else unexpectedToken();

    // All definitions start off the same except union
    let name = current();
    expect(identifier, "identifier");

    if (kind === "PICK") {
      expect(colon, '":"');
      let field = current();
      expect(identifier, "identifier");

      expect(leftBrace, '"{"');

      const fieldNames: string[] = [];

      picks[name.text] = {
        to: name,
        fieldNames,
        from: field,
      };

      while (!eat(rightBrace)) {
        field = current();
        expect(identifier, "identifier");
        if (fieldNames.includes(field.text)) {
          error("Fields must be unique", field.line, field.column);
        }
        fieldNames.push(field.text);
        expect(semicolon, ";");
      }

      continue;
    } else if (kind === "UNION") {
      expect(equals, '"="');

      let field = current();
      expect(identifier, "identifier");

      fields.push({
        name: field.text,
        line: field.line,
        column: field.column,
        type: field.text,
        isArray: false,
        isRequired: true,
        isDeprecated: false,
        value: fields.length + 1,
      });

      while (eat(unionOrToken)) {
        field = current();
        expect(identifier, "identifier");

        fields.push({
          name: field.text,
          line: field.line,
          column: field.column,
          type: field.text,
          isArray: false,
          isDeprecated: false,
          isRequired: true,
          value: fields.length + 1,
        });
      }

      if (eat(leftBrace)) {
        field = current();
        expect(identifier, "discriminator name");
        fields.unshift({
          type: "discriminator",
          name: field.text,
          line: field.line,
          column: field.column,
          isArray: false,
          isDeprecated: false,
          isRequired: true,
          value: 0,
        });
        expect(semicolon, ";");
        expect(rightBrace, "}");
      } else {
        expect(semicolon, '";"');
      }
    } else if (kind === "ALIAS") {
      expect(equals, "=");
      let field = current();
      expect(identifier, "identifier");
      fields.push({
        type: field.text,
        name: field.text,
        line: field.line,
        column: field.column,
        isArray: false,
        isDeprecated: false,
        isRequired: true,
        value: 1,
      });
      expect(semicolon, ";");
    } else {
      if (kind === "STRUCT") {
        while (eat(extendsToken)) {
          let field = current();
          expect(identifier, "discriminator name");
          if (!extensions) {
            extensions = [field.text];
          } else {
            extensions.push(field.text);
          }
        }
      }

      if (eat(serializerKeyword)) {
        expect(quoteToken, '"');
        serializerPath = "";
        while (!eat(quoteToken)) {
          serializerPath += current().text;
          index++;
        }
      }

      expect(leftBrace, '"{"');

      // Parse fields
      while (!eat(rightBrace)) {
        let type: string | null = null;
        let isArray = false;
        let isDeprecated = false;

        // Enums don't have types
        if (kind !== "ENUM" && kind !== "SMOL") {
          type = current().text;
          expect(identifier, "identifier");
          isArray = eat(arrayToken);
        }

        let field = current();
        expect(identifier, "identifier");

        // Structs don't have explicit values
        let value: Token | null = null;
        let isRequired = kind === "STRUCT";
        if (kind !== "STRUCT") {
          expect(equals, '"="');
          value = current();
          expect(integer, "integer");

          if (eat(requiredToken)) {
            isRequired = true;
          }

          if ((+value.text | 0) + "" !== value.text) {
            error(
              "Invalid integer " + quote(value.text),
              value.line,
              value.column
            );
          }
        }

        let deprecated = current();
        if (eat(deprecatedToken)) {
          if (kind !== "MESSAGE") {
            error(
              "Cannot deprecate this field",
              deprecated.line,
              deprecated.column
            );
          }

          isDeprecated = true;
        }

        expect(semicolon, '";"');

        fields.push({
          name: field.text,
          line: field.line,
          column: field.column,
          type: type,
          isArray: isArray,
          isDeprecated: isDeprecated,
          isRequired,
          value: value !== null ? +value.text | 0 : fields.length + 1,
        });
      }
    }

    definitions.push({
      name: name.text,
      line: name.line,
      column: name.column,
      kind: kind,
      fields: fields,
      extensions,
      serializerPath:
        serializerPath && serializerPath.trim().length > 0
          ? serializerPath
          : undefined,
    });
    serializerPath = "";
  }

  // This can definitely be made faster
  // but not gonna bother unless it shows up in some profiling at some point
  for (let definition of definitions) {
    if (definition.extensions) {
      for (let extension of definition.extensions) {
        let otherDefinition = definition;
        for (let i = 0; i < definitions.length; i++) {
          otherDefinition = definitions[i];
          if (extension === otherDefinition.name) {
            break;
          }
        }

        if (
          otherDefinition.name !== extension ||
          otherDefinition.kind !== "STRUCT"
        ) {
          error(
            `Expected ${otherDefinition.name} to to be a struct`,
            definition.line,
            definition.column
          );
        }

        let offset = definition.fields.length;
        for (let field of otherDefinition.fields) {
          definition.fields.push({
            ...field,
            value: field.value + offset,
          });
        }
      }
    }
  }

  let foundMatch = false;
  for (let partName in picks) {
    const pick = picks[partName];
    const token = pick.from;
    let definition: Definition = definitions[0];

    for (let i = 0; i < definitions.length; i++) {
      definition = definitions[i];

      if (definition.name === token.text) {
        foundMatch = true;
        break;
      }
    }

    if (!foundMatch) {
      error("Expected type for part to exist", token.line, token.column);
    }

    foundMatch = false;

    const fields = new Array<Field>(pick.fieldNames.length);
    let field = definition.fields[0];
    for (let i = 0; i < fields.length; i++) {
      let name = pick.fieldNames[i];
      foundMatch = false;
      field = definition.fields[0];

      for (let j = 0; j < definition.fields.length; j++) {
        if (definition.fields[j].name === name) {
          field = definition.fields[j];
          foundMatch = true;
        }
      }

      if (!foundMatch) {
        error(
          `Expected field ${name} to exist in ${definition.name}`,
          token.line,
          token.column
        );
      }

      fields[i] = {
        name: field.name,
        line: field.line,
        column: field.column,
        type: field.type,
        isRequired: true,
        isArray: field.isArray,
        isDeprecated: field.isDeprecated,
        value: i + 1,
      };
    }

    definitions.push({
      name: pick.to.text,
      line: token.line,
      column: token.column,
      kind: "STRUCT",
      fields,
    });
  }

  return {
    package: packageText,
    definitions: definitions,
  };
}

function verify(root: Schema): void {
  let definedTypes = nativeTypes.slice();
  let definitions: { [name: string]: Definition } = {};

  // Define definitions
  for (let i = 0; i < root.definitions.length; i++) {
    let definition = root.definitions[i];
    if (definedTypes.indexOf(definition.name) !== -1) {
      error(
        "The type " + quote(definition.name) + " is defined twice",
        definition.line,
        definition.column
      );
    }
    if (reservedNames.indexOf(definition.name) !== -1) {
      error(
        "The type name " + quote(definition.name) + " is reserved",
        definition.line,
        definition.column
      );
    }
    definedTypes.push(definition.name);
    definitions[definition.name] = definition;
  }

  // Check fields
  for (let i = 0; i < root.definitions.length; i++) {
    let definition = root.definitions[i];
    let fields = definition.fields;

    if (
      definition.kind === "ENUM" ||
      definition.kind === "SMOL" ||
      fields.length === 0
    ) {
      continue;
    }

    // Check types
    if (definition.kind === "UNION") {
      let state: { [key: string]: number } = {};

      for (let j = 0; j < fields.length; j++) {
        let field = fields[j];
        if (state[field.name]) {
          error(
            "The type " +
              quote(field.type!) +
              " can only appear in  " +
              quote(definition.name) +
              " once.",
            field.line,
            field.column
          );
        }

        state[field.name] = 1;
        if (definedTypes.indexOf(field.type!) === -1) {
          error(
            "The type " +
              quote(field.type!) +
              " is not defined for union " +
              quote(definition.name),
            field.line,
            field.column
          );
        }
      }
    } else if (definition.kind === "ALIAS") {
      const field = definition.fields[0];
      if (!field)
        error("Expected alias name", definition.line, definition.column);

      if (!(definitions[field.name] || nativeTypeMap[field.name])) {
        error(
          "Expected type used in alias to exist.",
          definition.line,
          definition.column
        );
      }
    } else {
      for (let j = 0; j < fields.length; j++) {
        let field = fields[j];
        if (definedTypes.indexOf(field.type!) === -1) {
          error(
            "The type " +
              quote(field.type!) +
              " is not defined for field " +
              quote(field.name),
            field.line,
            field.column
          );
        }

        if (field.type === "discriminator") {
          error(
            "discriminator is only available inside of unions.",
            field.line,
            field.column
          );
        }
      }
    }

    // Check values
    let values: number[] = [];
    for (let j = 0; j < fields.length; j++) {
      let field = fields[j];
      if (values.indexOf(field.value) !== -1) {
        error(
          "The id for field " + quote(field.name) + " is used twice",
          field.line,
          field.column
        );
      }
      if (field.value <= 0 && field.type !== "discriminator") {
        error(
          "The id for field " + quote(field.name) + " must be positive",
          field.line,
          field.column
        );
      }
      if (field.value > fields.length) {
        error(
          "The id for field " +
            quote(field.name) +
            " cannot be larger than " +
            fields.length,
          field.line,
          field.column
        );
      }
      values.push(field.value);
    }
  }

  // Check that structs don't contain themselves
  let state: { [name: string]: number } = {};
  let check = (name: string): boolean => {
    let definition = definitions[name];
    if (definition && definition.kind === "STRUCT") {
      if (state[name] === 1) {
        error(
          "Recursive nesting of " + quote(name) + " is not allowed",
          definition.line,
          definition.column
        );
      }
      if (state[name] !== 2 && definition) {
        state[name] = 1;
        let fields = definition.fields;
        for (let i = 0; i < fields.length; i++) {
          let field = fields[i];
          if (!field.isArray) {
            check(field.type!);
          }
        }
        state[name] = 2;
      }
    }
    return true;
  };

  for (let i = 0; i < root.definitions.length; i++) {
    check(root.definitions[i].name);
  }
}

export function parseSchema(text: string): Schema {
  const schema = parse(tokenize(text));
  verify(schema);
  return schema;
}
