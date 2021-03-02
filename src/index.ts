"use_strict";

import * as fs from "fs";
import * as path from "path";
import * as Handlebars from "handlebars";
import * as _ from "lodash";
import * as xml from "xml-js";
import * as OpenAPISampler from "openapi-sampler";
import * as OpenAPISnippet from "openapi-snippet";

import * as prettier from "prettier";
import bundler from "./bundler";

/**
 * Helper function to render a block of code
 * @param   {any}     data  the code as encoded string
 * @param   {any}     lang  code languaje
 * @param   {any}     title snippet title
 * @returns {string}  a JSON serialized representation of the object
 */
const codeBlock = (data: string, lang: string = "", title: string = ""): string => {
  const titleTag = title.length ? ` title="${title}"` : "";

  return `\`\`\`${lang}${titleTag}\n${data}\n\`\`\``;
};

/**
 * Helper function to serialize an object to JSON
 * @param   {any}     data the object to serialize
 * @returns {string}  a JSON serialized representation of the object
 */
const jsonCodeBlock = (data: any, title: string = ""): string => {
  const encoded = JSON.stringify(data, null, 2);
  const titleTag = title.length ? ` title="${title}"` : "";

  return `\`\`\`json${titleTag}\n${encoded}\n\`\`\``;
};

/**
 * Helper function to serialize an object to XML
 * @param   {string}  name XML name for this node
 * @param   {any}     data the object to serialize
 * @returns {string}  a XML serialized representation of the object
 */
const xmlCodeBlock = (elementName: string, data: any, title: string = ""): string => {
  const options = { compact: true, spaces: 2 };
  const obj = {
    _declaration: {
      _attributes: {
        version: "1.0",
        encoding: "utf-8",
      },
    },
    [elementName]: data,
  };

  const encoded = xml.json2xml(JSON.stringify(obj), options);
  const titleTag = title.length ? ` title="${title}"` : "";

  return `\`\`\`${titleTag}xml\n${encoded}\n\`\`\``;
};

type Optional = {
  /** @default "./build/" */
  outPath?: string;

  /** @default "../templates/" */
  templatePath?: string;

  /** @default ["curl"] */
  snippetTargets?: string[];
};

/**
 * Convert openapi spec to markdown
 * @param   {string}    specFile specification file
 * @param   {string}    outPath path to write documents
 * @param   {string}    templatePath path to markdown templates
 * @returns {Promise<void>}
 */
const convert = (specFile: string, options: Optional = {}): Promise<void> => {
  return new Promise((resolve, reject) => {
    const {
      outPath = path.resolve(process.cwd(), "./build"),
      templatePath = "../templates/",
      snippetTargets = ["shell"],
    } = options;

    try {
      // load the spec from a json into an object
      bundler(specFile, "./")
        .then((spec) => {
          if (fs.existsSync(outPath)) {
            // ToDo: delete existing path
          }

          Handlebars.registerHelper("codeSnippet", (content: string, lang: string, title: string) => {
            // render code block
            return codeBlock(content, lang, title);
          });

          Handlebars.registerHelper("schemaSample", (key: string, context: any) => {
            const sampler = () => OpenAPISampler.sample(context, {}, spec);

            if (key.toLowerCase().includes("xml")) {
              const name = Object.prototype.hasOwnProperty.call(context, "xml") ? context.xml.name : "item";
              return xmlCodeBlock(name, sampler());
            }

            // defaults to json code block
            return jsonCodeBlock(sampler());
          });

          Handlebars.registerHelper("schemaSampleWithTitle", (key: string, context: any, title: string) => {
            const sampler = () => OpenAPISampler.sample(context, {}, spec);

            if (key.toLowerCase().includes("xml")) {
              const name = Object.prototype.hasOwnProperty.call(context, "xml") ? context.xml.name : "item";
              return xmlCodeBlock(name, sampler(), title);
            }

            // defaults to json code block
            return jsonCodeBlock(sampler(), title);
          });

          Handlebars.registerHelper("firstKey", (context: any) => {
            // returns firts key for an object, useful for default variables
            return Object.keys(context)[0];
          });

          Handlebars.registerHelper("rawBlock", (context: any) => {
            // returns firts key for an object, useful for default variables
            return context.fn();
          });

          let pathTemplate;

          if (fs.existsSync(path.resolve(process.cwd(), templatePath, "path.hdb"))) {
            pathTemplate = Handlebars.compile(
              fs.readFileSync(path.resolve(process.cwd(), templatePath, "path.hdb"), "utf8")
            );
          } else if (fs.existsSync(path.resolve(__dirname, templatePath, "path.hdb"))) {
            pathTemplate = Handlebars.compile(
              fs.readFileSync(path.resolve(__dirname, templatePath, "path.hdb"), "utf8")
            );
          } else {
            reject("Can not find templates path");
          }

          // iterate paths
          Object.keys(spec.paths).forEach((pathKey: string) => {
            const apiPath = (spec.paths as any)[pathKey];

            // try to create output paths
            fs.mkdirSync(`${outPath}${pathKey}`, { recursive: true });

            Object.keys(apiPath).forEach((methodKey: string) => {
              const method = (apiPath as any)[methodKey];

              // generate snippets for this endpoint
              const generatedCode = OpenAPISnippet.getEndpointSnippets(spec, pathKey, methodKey, snippetTargets);

              Object.values(generatedCode.snippets).forEach((snippet: { [k: string]: any }) => {
                const { id } = snippet as any;

                snippet.lang = id.split("_")[0].replace("node", "javascript");
              });

              // render the path using Handlebars and save it
              fs.writeFileSync(
                `${outPath}${pathKey}/${methodKey}.md`,
                prettier.format(
                  pathTemplate({
                    slug: _.kebabCase(`${pathKey}-${methodKey}`),
                    path: pathKey,
                    httpMethod: _.toUpper(methodKey),
                    method: method,
                    snippets: generatedCode.snippets,
                  }),
                  {
                    parser: "markdown",
                  }
                )
              );
            });
          });

          // all done
          resolve();
        })
        .catch((err) => {
          reject(err);
        });
    } catch (err) {
      reject(err);
    }
  });
};

export default convert;
