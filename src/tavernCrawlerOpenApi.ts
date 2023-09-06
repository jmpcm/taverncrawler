import { faker } from '@faker-js/faker';
import { default as OASNormalize } from 'oas-normalize';
import { join } from 'path';
import { URL } from 'url';
import { Position, window, workspace } from "vscode";
import { Document } from 'yaml';

export async function importApiSpecificationFromUrl() {
    const MAX_RETRIES = 3;

    let url: string | undefined = undefined;
    let retries = 0;

    do {
        url = await window.showInputBox({ placeHolder: "URL" });
        retries += 1;
    }
    while ((url === undefined || url === '') && retries < MAX_RETRIES);

    let openApiUrl: URL;
    try {
        openApiUrl = new URL(url!);
    } catch (err) {
        window.showErrorMessage(`Invalid URL inserted.`);
        return;
    }

    let tavernDefinition: string | undefined;
    try {
        tavernDefinition = await importOpenApiToTavern(openApiUrl);
    } catch (err) {
        window.showErrorMessage(`Failed to importing OpenAPI specification: ${err}`);
        return;
    }

    if (tavernDefinition === undefined) {
        window.showErrorMessage(`Error importing OpenAPI specification from ${url}.`);
        return;
    }

    let document = await workspace.openTextDocument();
    let editor = await window.showTextDocument(document);
    editor.edit((edit) => {
        edit.insert(new Position(0, 0), tavernDefinition!);
    });
}

class ApiSpecificationResolver {
    private _components: Map<string, any>;

    constructor(readonly definition: unknown) {
        this._components = new Map<string, any>();
    }

    createSchema(contentDefinition: any): any {
        if (contentDefinition === undefined
            || !contentDefinition.hasOwnProperty('application/json')) {
            return undefined;
        }

        const refName: string = contentDefinition['application/json'].schema.$ref ?? undefined;
        let schemaObject = refName !== undefined
            ? this._resolveSchemaReference(refName)
            : this._resolveSchemaObject(contentDefinition['application/json']);

        return this._instantiateSchema(schemaObject);
    }

    getSchema(schemaRef: string): any {
        return this._components.get(schemaRef);
    }

    hasContentSchema(schemaRef: string): boolean {
        return this._components.has(schemaRef);
    }

    private _instantiateSchema(schema: Record<string, any>): any {
        let newObj = {};
        Object.entries(schema).forEach((e) => {
            // @ts-expect-error
            newObj[e[0]] = e[1] instanceof Function ? e[1]() : this._instantiateSchema(e[1]);
        });

        return newObj;
    }

    private _resolveSchemaObject(schemaDefinition: any): any {
        // Sometimes the schema might have a definition, without a reference to an object.
        let schemaObject: Record<string, any> = {};
        let entries = Object.entries(schemaDefinition.type === 'object'
            ? schemaDefinition.properties
            : schemaDefinition);

        for (const [propName, propObject] of entries) {
            // @ts-expect-error
            switch (propObject.type) {
                case 'boolean':
                    schemaObject[propName] = () => [true, false][Math.floor(Math.random() * 2)];
                    break;
                case 'float':
                    schemaObject[propName] = () => faker.number.float();
                    break;
                case 'integer':
                case 'number':
                    schemaObject[propName] = () => faker.number.int();
                    break;
                case 'string':
                    schemaObject[propName] = () => {
                        const lowerCasePropName = propName.toLocaleLowerCase();

                        if (lowerCasePropName === 'name') {
                            return faker.person.firstName();
                        } else if (lowerCasePropName === 'id') {
                            return faker.string.uuid();
                        } else if (lowerCasePropName === 'username') {
                            return faker.internet.userName();
                        } else if (lowerCasePropName === 'password') {
                            return faker.internet.password();
                        } else if (lowerCasePropName === 'email') {
                            return faker.internet.email();
                        } else if (lowerCasePropName === 'firstname') {
                            return faker.person.firstName();
                        } else if (lowerCasePropName === 'lastname') {
                            return faker.person.lastName();
                        } else if (lowerCasePropName === 'phone') {
                            return faker.phone.number();
                        } else {
                            return faker.word.words({ count: 1 });
                        }
                    };
                    // TODO if it has enum property
                    break;
                case 'array':
                    schemaObject[propName] = Array;
                    break;
                case 'schema':
                case 'object':
                    // @ts-expect-error
                    schemaObject[propName] = this._resolveSchemaReference(propObject.items.$ref);
                    break;
                default:
                    // @ts-expect-error
                    if (propObject.hasOwnProperty('$ref')) {
                        // @ts-expect-error
                        schemaObject[propName] = this._resolveSchemaReference(propObject.$ref);
                    }
                    break;
            }
        }

        return schemaObject;
    }

    private _resolveSchemaReference(reference: string) {
        let schemaObject: Record<string, any> = this._components.get(reference);

        if (schemaObject !== undefined) {
            return schemaObject;
        }

        schemaObject = {};

        let tokens = reference.split('/');
        // @ts-expect-error
        let schemaDefinition: any = this.definition[tokens[1]];
        tokens.slice(2).forEach((s) => {
            schemaDefinition = schemaDefinition[s];
        });

        return this._resolveSchemaObject(schemaDefinition);
    }
}

//@ts-ignore
async function importOpenApiToTavern(openApiFileUrl: URL): Promise<string | undefined> {
    const oas = new OASNormalize(openApiFileUrl.href);

    // try {
    //     let definition = await oas.validate({ convertToLatest: true });
    //     let host: URL;

    //     try {
    //         host = new URL(definition.servers[0]["url"]);
    //     } catch (err) {
    //         // The URL constructor returns a TypeError exception if the path is relative.
    //         const requestServer = new URL(oas.file);
    //         host = new URL(definition.servers[0]["url"], requestServer.origin);
    //     }

    //     let tavernDocumentTokens: string[] = [];

    //     for (const [path, methods] of Object.entries(definition.paths)) {
    //         for (const [method, operation] of Object.entries(methods)) {
    //             let commentAdded = false;

    //             for (const [response, responseObject] of Object.entries(operation.responses)) {
    //                 const operationId = 'operationId' in operation
    //                     ? [`${operation.operationId}_${method.toLocaleLowerCase()}_${response}`]
    //                     : undefined;

    //                 let testDocument = new Document({
    //                     test_name: `${operation.summary} [${method.toLocaleUpperCase()} ${path} ${response}]` ?? 'default_test_name',
    //                     marks: operationId,
    //                     stages: [
    //                         {
    //                             name: operation.operationId ?? 'default_stage_name',
    //                             request: {
    //                                 url: decodeURI(`${host.origin}${join(host.pathname, path)}`),
    //                                 method: method.toUpperCase(),
    //                             },
    //                             response: {
    //                                 status_code: response === 'default' ? 'default' : parseInt(response)
    //                             }
    //                         }
    //                     ]
    //                 });

    //                 if (!commentAdded) {
    //                     testDocument.commentBefore = `${method.toUpperCase()} ${path}\n`
    //                         + `${JSON.stringify(operation, null, 4)}`;
    //                     commentAdded = true;
    //                 }

    //                 tavernDocumentTokens.push(testDocument.toString({ directives: true }));
    //             }
    //         }
    //     }

    //     return tavernDocumentTokens.join('\n');
    // } catch (err) {
    //     throw new Error(err.message);
    // }
    try {
        const definition = await oas.validate({ convertToLatest: true });
        const resolver = new ApiSpecificationResolver(definition);
        let host: URL;

        try {
            host = new URL(definition.servers[0]["url"]);
        } catch (err) {
            // The URL constructor returns a TypeError exception if the path is relative.
            const requestServer = new URL(oas.file);
            host = new URL(definition.servers[0]["url"], requestServer.origin);
        }

        let tavernDocumentTokens: string[] = [];

        for (const [path, methods] of Object.entries(definition.paths)) {
            // @ts-expect-error
            for (const [method, operation] of Object.entries(methods)) {
                let commentAdded = false;

                // @ts-expect-error
                for (const [response, responseObject] of Object.entries(operation.responses)) {
                    // @ts-expect-error
                    const operationId = 'operationId' in operation
                        ? [`${operation.operationId}_${method.toLocaleLowerCase()}_${response}`]
                        : undefined;

                    let testDocument = new Document({
                        // @ts-expect-error
                        test_name: `${operation.summary} [${method.toLocaleUpperCase()} ${path} ${response}]` ?? 'default_test_name',
                        marks: operationId,
                        stages: [
                            {
                                // @ts-expect-error
                                name: operation.operationId ?? 'default_stage_name',
                                request: {
                                    url: decodeURI(`${host.origin}${join(host.pathname, path)}`),
                                    method: method.toUpperCase(),
                                    // @ts-expect-error
                                    json: resolver.createSchema(operation.requestBody?.content)
                                },
                                response: {
                                    status_code: response === 'default' ? 'default' : parseInt(response)
                                }
                            }
                        ]
                    });

                    if (!commentAdded) {
                        testDocument.commentBefore = `${method.toUpperCase()} ${path}\n`
                            + `${JSON.stringify(operation, null, 4)}`;
                        commentAdded = true;
                    }

                    tavernDocumentTokens.push(testDocument.toString({ directives: true }));
                }
            }
        }

        return tavernDocumentTokens.join('\n');

    } catch (err: any) {
        throw new Error(err.message);
    }
};