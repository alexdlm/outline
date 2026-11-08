import { z } from "zod";
import { BaseSchema } from "@server/routes/api/schema";
import { zodIdType } from "@server/utils/zod";
import { CodecksMappingSchema } from "../gate";

/** The request to connect a Codecks organization, or to replace its token. */
export const CodecksConnectSchema = BaseSchema.extend({
  body: z.object({
    /**
     * An organization API token, created in Codecks under Organization
     * Settings. Not named "token", which authentication reads as the
     * caller's own credential.
     */
    apiToken: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .regex(/^[\x21-\x7e]+$/, "The token contains invalid characters."),

    /** The organization's subdomain, a codecks.io address is also accepted. */
    subdomain: z
      .string()
      .trim()
      .toLowerCase()
      .transform((value) =>
        value.replace(/^https?:\/\//, "").replace(/\.codecks\.io(\/.*)?$/, "")
      )
      .pipe(
        z
          .string()
          .regex(
            /^[a-z0-9-]{1,63}$/,
            "Enter the subdomain of your Codecks organization, as in https://subdomain.codecks.io."
          )
      ),
  }),
});

export type CodecksConnectReq = z.infer<typeof CodecksConnectSchema>;

/** The request to replace the project to collection mappings. */
export const CodecksUpdateSchema = BaseSchema.extend({
  body: z
    .object({
      /** Replaces all mappings of the team, left unchanged when omitted. */
      mappings: z
        .array(
          CodecksMappingSchema.extend({
            projectName: z.string().trim().max(255),
            defaultDeckId:
              CodecksMappingSchema.shape.defaultDeckId.default(null),
          })
        )
        .max(100)
        .optional(),

      /** Which optional card details chips show, omitted options are unchanged. */
      display: z
        .object({
          effort: z.boolean().optional(),
          assignee: z.boolean().optional(),
        })
        .optional(),
    })
    .refine((body) => body.mappings || body.display, {
      message: "Provide mappings or display options to update.",
    }),
});

export type CodecksUpdateReq = z.infer<typeof CodecksUpdateSchema>;

/** The request to search the cards that a user may mention. */
export const CodecksSearchSchema = BaseSchema.extend({
  body: z.object({
    /** A short id, part of a card title, or empty for recently updated cards. */
    query: z.string().trim().max(100).default(""),

    /** The document being edited, results are narrowed to its collection's projects. */
    documentId: zodIdType().optional(),
  }),
});

export type CodecksSearchReq = z.infer<typeof CodecksSearchSchema>;
