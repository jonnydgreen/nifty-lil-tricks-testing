// Copyright 2023-2023 the Nifty li'l' tricks authors. All rights reserved. MIT license.

import {
  assertNever,
  type Plugin,
  type PluginInstance,
  type SetupTestsTeardown,
} from "https://deno.land/x/nifty_lil_tricks_testing/mod.ts";
import {
  DatabaseConfig,
  DatabaseOutput,
  DatabaseStrategy,
} from "./database.ts";
import {
  type MigrationConfig,
  type MigrationOutput,
  MigrationStrategy,
} from "./migration.ts";
import { SqlMigrationStrategy } from "./migration_sql.ts";
import { type SeedConfig, SeedOutput, SeedStrategy } from "./seed.ts";
import { Server, ServerConfig, ServerStrategy } from "./server.ts";
import { ConnectionStrategy } from "./server_connection.ts";
import {
  DockerServerStrategy,
  type DockerServerStrategyConfig,
} from "./server_docker.ts";

class PluginFactory {
  public create(): PostgreSqlPlugin {
    return {
      setup: this.#setup.bind(this),
    };
  }

  async #setup(
    config: PluginConfig,
  ): Promise<PluginInstance<PluginResult>> {
    let setup: PluginInstance<Server>;
    if (config.server instanceof Server) {
      setup = await this.#setupExistingDatabaseServer(config.server);
    } else {
      setup = await this.#setupNewDatabaseServer(config.server);
    }
    const { teardown } = setup;
    await setup.output.init();

    const { server, teardown: teardownDatabase } = await this
      .#shouldRunDatabaseCreation(
        config,
        setup.output,
      );

    return {
      teardown: this.#buildTeardown([teardownDatabase, teardown]),
      output: {
        server,
        migrate: await this.#shouldRunMigration(config, server),
        seed: await this.#shouldRunSeed(config, server),
      },
    };
  }

  #buildTeardown(
    teardowns: PluginInstance<Server>["teardown"][],
  ): SetupTestsTeardown {
    return async () => {
      for (const teardown of teardowns) {
        await teardown();
      }
    };
  }

  #setupExistingDatabaseServer(
    server: Server,
  ): Promise<PluginInstance<Server>> {
    const strategy = new ConnectionStrategy(server);
    return strategy.setup();
  }

  #setupNewDatabaseServer(
    config: ServerConfig,
  ): Promise<PluginInstance<Server>> {
    const suffix = Math.random().toString(36).substring(2);
    const database = config.databaseName ||
      `${config.databaseNamePrefix || "postgres"}-${suffix}`;
    const serverName = `${
      config.databaseServerNamePrefix || "postgres"
    }-${suffix}`;
    const port = config.port ?? 0;
    const user = config.user ??
      Math.random().toString(36).substring(2);
    const password = config.password ??
      Math.random().toString(36).substring(2);
    const version = config.version || "latest";

    switch (config.strategy) {
      case ServerStrategy.DOCKER: {
        const dockerConfig: DockerServerStrategyConfig = {
          serverName,
          port,
          user,
          password,
          database,
          version,
        };
        const strategy = new DockerServerStrategy(dockerConfig);
        return strategy.setup();
      }
      default: {
        return assertNever(
          config.strategy,
          `Unknown strategy: ${config.strategy}`,
        );
      }
    }
  }

  #shouldRunDatabaseCreation(
    config: PluginConfig,
    server: Server,
  ): DatabaseOutput | Promise<DatabaseOutput> {
    if (!config.database) {
      return { server, teardown: () => Promise.resolve() };
    }
    const strategy = new DatabaseStrategy(config.database, server);
    return strategy.run();
  }

  #shouldRunMigration(
    config: PluginConfig,
    server: Server,
  ): MigrationOutput | Promise<MigrationOutput> {
    if (!config.migrate) {
      return { results: [] };
    }
    switch (config.migrate.strategy) {
      case MigrationStrategy.SQL: {
        const strategy = new SqlMigrationStrategy(
          config.migrate,
          server.connection,
        );
        return strategy.run();
      }
      default: {
        return assertNever(
          config.migrate.strategy,
          `Unknown migration strategy: ${config.migrate.strategy}`,
        );
      }
    }
  }

  #shouldRunSeed(
    config: PluginConfig,
    server: Server,
  ): SeedOutput | Promise<SeedOutput> {
    if (!config.seed) {
      return { results: [] };
    }
    const strategy = new SeedStrategy(config.seed, server.connection);
    return strategy.run();
  }
}

/**
 * The PostgreSQL Plugin.
 *
 * **Basic server setup:**
 * @example
 * ```ts
 * import { setupTestsFactory } from "https://deno.land/x/nifty_lil_tricks_testing/mod.ts";
 * import { postgreSqlPlugin, type PluginConfig, ServerStrategy } from "https://deno.land/x/nifty_lil_tricks_testing/plugin_postgresql/mod.ts";
 *
 * const { setupTests } = setupTestsFactory({ database: postgreSqlPlugin });
 *
 * const { teardownTests } = await setupTests({
 *   database: {
 *     server: { strategy: ServerStrategy.DOCKER },
 *   } as PluginConfig,
 * });
 *
 * // Do work
 *
 * // Teardown when finished
 * await teardownTests();
 * ```
 *
 * **Existing server setup:**
 * @example
 * ```ts
 * import { setupTestsFactory } from "https://deno.land/x/nifty_lil_tricks_testing/mod.ts";
 * import { postgreSqlPlugin, type PluginConfig, Server } from "https://deno.land/x/nifty_lil_tricks_testing/plugin_postgresql/mod.ts";
 *
 * const { setupTests } = setupTestsFactory({ database: postgreSqlPlugin });
 *
 * const server = new Server("id", {
 *   serverName: "serverName",
 *   hostname: "hostname",
 *   port: 1234,
 *   user: "user",
 *   password: "password",
 *   database: "database",
 * });
 * const { teardownTests } = await setupTests({
 *   database: { server } as PluginConfig,
 * });
 *
 * // Do work
 *
 * // Teardown when finished
 * await teardownTests(); // No-op
 * ```
 *
 * **Server setup with migrations:**
 * @example
 * ```ts
 * import { dirname, fromFileUrl } from "https://deno.land/std/path/mod.ts";
 * import { setupTestsFactory } from "https://deno.land/x/nifty_lil_tricks_testing/mod.ts";
 * import { postgreSqlPlugin, type PluginConfig, ServerStrategy, MigrationStrategy } from "https://deno.land/x/nifty_lil_tricks_testing/plugin_postgresql/mod.ts";
 *
 * const root = dirname(fromFileUrl(import.meta.url));
 *
 * const { setupTests } = setupTestsFactory({ database: postgreSqlPlugin });
 *
 * const { teardownTests } = await setupTests({
 *   database: {
 *     server: { strategy: ServerStrategy.DOCKER },
 *     migrate: { strategy: MigrationStrategy.SQL, root },
 *   } as PluginConfig,
 * });
 *
 * // Do work
 *
 * // Teardown when finished
 * await teardownTests();
 * ```
 *
 * **Server setup with migrations and seeding:**
 * @example
 * ```ts
 * import { dirname, fromFileUrl } from "https://deno.land/std/path/mod.ts";
 * import { setupTestsFactory } from "https://deno.land/x/nifty_lil_tricks_testing/mod.ts";
 * import { postgreSqlPlugin, type PluginConfig, ServerStrategy, MigrationStrategy } from "https://deno.land/x/nifty_lil_tricks_testing/plugin_postgresql/mod.ts";
 *
 * const root = dirname(fromFileUrl(import.meta.url));
 *
 * const { setupTests } = setupTestsFactory({ database: postgreSqlPlugin });
 *
 * const { teardownTests } = await setupTests({
 *   database: {
 *     server: { strategy: ServerStrategy.DOCKER },
 *     migrate: { strategy: MigrationStrategy.SQL, root },
 *     seed: {
 *       User: [
 *         { email: "email 1", name: "name 1" },
 *         { email: "email 2", name: "name 2" },
 *       ],
 *     },
 *   } as PluginConfig,
 * });
 *
 * // Do work
 *
 * // Teardown when finished
 * await teardownTests();
 * ```
 *
 * **Server setup with custom database, migrations and seeding:**
 * @example
 * ```ts
 * import { dirname, fromFileUrl } from "https://deno.land/std/path/mod.ts";
 * import { setupTestsFactory } from "https://deno.land/x/nifty_lil_tricks_testing/mod.ts";
 * import { postgreSqlPlugin, type PluginConfig, ServerStrategy, MigrationStrategy } from "https://deno.land/x/nifty_lil_tricks_testing/plugin_postgresql/mod.ts";
 *
 * const root = dirname(fromFileUrl(import.meta.url));
 *
 * const { setupTests } = setupTestsFactory({ database: postgreSqlPlugin });
 *
 * const { teardownTests } = await setupTests({
 *   database: {
 *     server: { strategy: ServerStrategy.DOCKER },
 *     database: { prefix: "custom" },
 *     migrate: { strategy: MigrationStrategy.SQL, root },
 *     seed: {
 *       User: [
 *         { email: "email 1", name: "name 1" },
 *         { email: "email 2", name: "name 2" },
 *       ],
 *     },
 *   } as PluginConfig,
 * });
 *
 * // Do work
 *
 * // Teardown when finished
 * await teardownTests();
 * ```
 *
 * **Migrations and seeding against existing server:**
 * @example
 * ```ts
 * import { dirname, fromFileUrl } from "https://deno.land/std/path/mod.ts";
 * import { setupTestsFactory } from "https://deno.land/x/nifty_lil_tricks_testing/mod.ts";
 * import { postgreSqlPlugin, type PluginConfig, Server, MigrationStrategy } from "https://deno.land/x/nifty_lil_tricks_testing/plugin_postgresql/mod.ts";
 *
 * const root = dirname(fromFileUrl(import.meta.url));
 *
 * const { setupTests } = setupTestsFactory({ database: postgreSqlPlugin });
 *
 * const server = new Server("id", {
 *   serverName: "serverName",
 *   hostname: "hostname",
 *   port: 1234,
 *   user: "user",
 *   password: "password",
 *   database: "database",
 * });
 * const { teardownTests } = await setupTests({
 *   database: {
 *     server,
 *     migrate: { strategy: MigrationStrategy.SQL, root },
 *     seed: {
 *       User: [
 *         { email: "email 1", name: "name 1" },
 *         { email: "email 2", name: "name 2" },
 *       ],
 *     },
 *   } as PluginConfig,
 * });
 *
 * // Do work
 *
 * // Teardown when finished
 * await teardownTests();
 * ```
 */
export const postgreSqlPlugin = new PluginFactory().create();

/**
 * The PostgreSQL Plugin config. One can find example configurations below:
 *
 * **Basic server setup:**
 * @example
 * ```ts
 * import { setupTestsFactory } from "https://deno.land/x/nifty_lil_tricks_testing/mod.ts";
 * import { postgreSqlPlugin, type PluginConfig, ServerStrategy } from "https://deno.land/x/nifty_lil_tricks_testing/plugin_postgresql/mod.ts";
 *
 * const { setupTests } = setupTestsFactory({ database: postgreSqlPlugin });
 *
 * const { teardownTests } = await setupTests({
 *   database: {
 *     server: { strategy: ServerStrategy.DOCKER },
 *   } as PluginConfig,
 * });
 *
 * // Do work
 *
 * // Teardown when finished
 * await teardownTests();
 * ```
 *
 * **Existing server setup:**
 * @example
 * ```ts
 * import { setupTestsFactory } from "https://deno.land/x/nifty_lil_tricks_testing/mod.ts";
 * import { postgreSqlPlugin, type PluginConfig, Server } from "https://deno.land/x/nifty_lil_tricks_testing/plugin_postgresql/mod.ts";
 *
 * const { setupTests } = setupTestsFactory({ database: postgreSqlPlugin });
 *
 * const server = new Server("id", {
 *   serverName: "serverName",
 *   hostname: "hostname",
 *   port: 1234,
 *   user: "user",
 *   password: "password",
 *   database: "database",
 * });
 * const { teardownTests } = await setupTests({
 *   database: { server } as PluginConfig,
 * });
 *
 * // Do work
 *
 * // Teardown when finished
 * await teardownTests(); // No-op
 * ```
 *
 * **Server setup with migrations:**
 * @example
 * ```ts
 * import { dirname, fromFileUrl } from "https://deno.land/std/path/mod.ts";
 * import { setupTestsFactory } from "https://deno.land/x/nifty_lil_tricks_testing/mod.ts";
 * import { postgreSqlPlugin, type PluginConfig, ServerStrategy, MigrationStrategy } from "https://deno.land/x/nifty_lil_tricks_testing/plugin_postgresql/mod.ts";
 *
 * const root = dirname(fromFileUrl(import.meta.url));
 *
 * const { setupTests } = setupTestsFactory({ database: postgreSqlPlugin });
 *
 * const { teardownTests } = await setupTests({
 *   database: {
 *     server: { strategy: ServerStrategy.DOCKER },
 *     migrate: { strategy: MigrationStrategy.SQL, root },
 *   } as PluginConfig,
 * });
 *
 * // Do work
 *
 * // Teardown when finished
 * await teardownTests();
 * ```
 *
 * **Server setup with migrations and seeding:**
 * @example
 * ```ts
 * import { dirname, fromFileUrl } from "https://deno.land/std/path/mod.ts";
 * import { setupTestsFactory } from "https://deno.land/x/nifty_lil_tricks_testing/mod.ts";
 * import { postgreSqlPlugin, type PluginConfig, ServerStrategy, MigrationStrategy } from "https://deno.land/x/nifty_lil_tricks_testing/plugin_postgresql/mod.ts";
 *
 * const root = dirname(fromFileUrl(import.meta.url));
 *
 * const { setupTests } = setupTestsFactory({ database: postgreSqlPlugin });
 *
 * const { teardownTests } = await setupTests({
 *   database: {
 *     server: { strategy: ServerStrategy.DOCKER },
 *     migrate: { strategy: MigrationStrategy.SQL, root },
 *     seed: {
 *       User: [
 *         { email: "email 1", name: "name 1" },
 *         { email: "email 2", name: "name 2" },
 *       ],
 *     },
 *   } as PluginConfig,
 * });
 *
 * // Do work
 *
 * // Teardown when finished
 * await teardownTests();
 * ```
 *
 * **Server setup with custom database, migrations and seeding:**
 * @example
 * ```ts
 * import { dirname, fromFileUrl } from "https://deno.land/std/path/mod.ts";
 * import { setupTestsFactory } from "https://deno.land/x/nifty_lil_tricks_testing/mod.ts";
 * import { postgreSqlPlugin, type PluginConfig, ServerStrategy, MigrationStrategy } from "https://deno.land/x/nifty_lil_tricks_testing/plugin_postgresql/mod.ts";
 *
 * const root = dirname(fromFileUrl(import.meta.url));
 *
 * const { setupTests } = setupTestsFactory({ database: postgreSqlPlugin });
 *
 * const { teardownTests } = await setupTests({
 *   database: {
 *     server: { strategy: ServerStrategy.DOCKER },
 *     database: { prefix: "custom" },
 *     migrate: { strategy: MigrationStrategy.SQL, root },
 *     seed: {
 *       User: [
 *         { email: "email 1", name: "name 1" },
 *         { email: "email 2", name: "name 2" },
 *       ],
 *     },
 *   } as PluginConfig,
 * });
 *
 * // Do work
 *
 * // Teardown when finished
 * await teardownTests();
 * ```
 *
 * **Migrations and seeding against existing server:**
 * @example
 * ```ts
 * import { dirname, fromFileUrl } from "https://deno.land/std/path/mod.ts";
 * import { setupTestsFactory } from "https://deno.land/x/nifty_lil_tricks_testing/mod.ts";
 * import { postgreSqlPlugin, type PluginConfig, Server, MigrationStrategy } from "https://deno.land/x/nifty_lil_tricks_testing/plugin_postgresql/mod.ts";
 *
 * const root = dirname(fromFileUrl(import.meta.url));
 *
 * const { setupTests } = setupTestsFactory({ database: postgreSqlPlugin });
 *
 * const server = new Server("id", {
 *   serverName: "serverName",
 *   hostname: "hostname",
 *   port: 1234,
 *   user: "user",
 *   password: "password",
 *   database: "database",
 * });
 * const { teardownTests } = await setupTests({
 *   database: {
 *     server,
 *     migrate: { strategy: MigrationStrategy.SQL, root },
 *     seed: {
 *       User: [
 *         { email: "email 1", name: "name 1" },
 *         { email: "email 2", name: "name 2" },
 *       ],
 *     },
 *   } as PluginConfig,
 * });
 *
 * // Do work
 *
 * // Teardown when finished
 * await teardownTests();
 * ```
 */
export interface PluginConfig {
  /**
   * The Database Server config.
   */
  server: ServerConfig | Server;

  /**
   * The Database config for the database creation. If not specified, no database will be created.
   */
  database?: DatabaseConfig;

  /**
   * The Database Migration config. If not specified, no migrations will be run.
   */
  migrate?: MigrationConfig;

  /**
   * The Database Seed config. If not specified, no seeding will be done.
   */
  seed?: SeedConfig;
}

/**
 * PostgreSQL Plugin Result.
 */
export interface PluginResult {
  /**
   * The Database Server instance.
   */
  readonly server: Server;

  /**
   * The migration output.
   */
  readonly migrate: MigrationOutput;

  /**
   * The seed output.
   */
  readonly seed: SeedOutput;
}

/**
 * The PostgreSQL Plugin.
 */
export type PostgreSqlPlugin = Plugin<
  PluginConfig,
  PluginResult
>;
