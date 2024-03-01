import { Context, Schema, Logger, Database } from "koishi";
import { } from "koishi-plugin-cron";
import { Discord } from "@koishijs/plugin-adapter-discord";

export const name = "articles-autopush";

export const inject = ['cron', 'database']

declare module 'koishi' {
    interface Tables {
        autopush: Autopush
    }
}

export interface Autopush {
    id: number
    title: string
    url: string
    author: string
    lastindex: number
    platform: string
    channelId: string
}

export function apply(ctx: Context) {
    var pagesPushQueryString =
        ' \
    query pagesPushQueryString($baseUrl: String) { \
        pages( \
          sort: {order: DESC, key: CREATED_AT} \
          filter: {_and: {url: {startsWith: $baseUrl}, wikidotInfo: {_and: {tags: {eq: "原创"}, category: {neq: "deleted"}, isPrivate: false}}}} \
        ) { \
          edges { \
            node { \
              url \
              wikidotInfo { \
                title \
                rating \
                createdBy { \
                  name \
                } \
              } \
            } \
          } \
        } \
      } \
      ';

    var apiList = [
        "https://api.crom.avn.sh/graphql",
        "https://zh.xjo.ch/crom/graphql",
    ];

    var branchInfo = {
        cn: {
            url: "http://backrooms-wiki-cn.wikidot.com",
        },
        en: {
            url: "http://backrooms-wiki.wikidot.com",
        },
        es: {
            url: "http://es-backrooms-wiki.wikidot.com",
        },
        fr: {
            url: "http://fr-backrooms-wiki.wikidot.com",
        },
        jp: {
            url: "http://japan-backrooms-wiki.wikidot.com",
        },
        pl: {
            url: "http://pl-backrooms-wiki.wikidot.com",
        },
        ptbr: {
            url: "http://pt-br-backrooms-wiki.wikidot.com",
        },
        ru: {
            url: "http://ru-backrooms-wiki.wikidot.com",
        },
        vn: {
            url: "http://backrooms-vn.wikidot.com",
        },
        all: {
            url: "",
        },
    };

    ctx.model.extend('autopush', {
        id: 'unsigned',
        title: 'text',
        url: 'text',
        author: 'text',
        lastindex: 'unsigned',
        platform: 'text',
        channelId: 'text'
    });

    ctx
        .command("autopush.bind", "为频道设置自动推送", { authority: 3 })
        .option("id", "-id [id:number] 设定频道对应的数据库 ID", {fallback: 1})
        .action(async ({ session, options }) => {
            let platform: string, channelId: string;
            platform = session.platform;
            channelId = session.channelId
            ctx.cron("*/5 * * * *", async () => {
                autoPush(options["id"], platform, channelId);
            });
            return "已指定此频道为 " + options["id"] + " 号频道。";
        });

    ctx.on("ready", async () => {
        let databaseExist: object;
        databaseExist = await ctx.database.get("autopush", 1);
        if (databaseExist[0] != undefined) {
            ctx.cron("*/5 * * * *", async () => {
                for (let index = 0; ; index++) {
                    let selectedDatabase: object = await ctx.database.select("autopush").orderBy("id", "asc").execute();
                    if (selectedDatabase[index] != undefined) {
                        autoPush(selectedDatabase[index].id, selectedDatabase[index].platform, selectedDatabase[index].channelId);
                    }
                    else break;
                }
            });
        }
    });

    async function autoPush(id: number, platform: string, channelId: string) {
        let car: Promise<any>;
        car = cromApiRequest(branchInfo["cn"]["url"], 0, pagesPushQueryString);

        let urlExist: object;
        urlExist = await ctx.database.get("autopush", id);
        if (urlExist[0] == undefined) {
            ctx.database.create("autopush", { id: id, title: "", url: "", author: "", lastindex: 10, platform: platform, channelId: channelId });
            urlExist = await ctx.database.get("autopush", id);
        }

        car.then(async (Result) => {
            let pagelist: Object;
            let isPush: Boolean;
            let pushIndex: number;
            pagelist = Result.pages.edges;
            for (let index = 9; index >= 0; index--) {
                let node = pagelist[index].node;
                isPush = true;
                if (urlExist[0].url != node.url) {
                    pushIndex = 9;
                    continue;
                }
                else {
                    pushIndex = index - 1;
                    isPush = (pushIndex != urlExist[0].lastindex - 1 || pushIndex > 0);
                    break;
                }
            }

            if (isPush) {
                for (let index = pushIndex; index >= 0; index--) {
                    let node = pagelist[index].node;
                    ctx.database.upsert("autopush", [
                        { id: id, title: node.wikidotInfo.title, url: node.url, author: node.wikidotInfo.createdBy.name, lastindex: pushIndex, platform: platform, channelId: channelId }
                    ]);
                    ctx.broadcast([platform + ":" + channelId], "新文章发布：\n【" + node.wikidotInfo.title + "】by " + node.wikidotInfo.createdBy.name + "\n" + node.url);
                    await ctx.sleep(1000);
                }
            }
        })
    }

    async function cromApiRequest(
        baseUrl: string,
        endpointIndex: number,
        queryString: string
    ) {
        const response = await fetch(apiList[endpointIndex], {
            method: "POST",
            headers: new Headers({
                "Content-Type": "application/json",
            }),
            body: JSON.stringify({
                query: queryString,
                variables: {
                    anyBaseUrl: baseUrl != "" ? baseUrl : null,
                    baseUrl: baseUrl,
                },
            }),
        });

        if (!response.ok) {
            throw new Error("Got status code: " + response.status);
        }

        const { data, errors } = await response.json();

        if (errors && errors.length > 0) {
            if (endpointIndex++ < apiList.length) {
                cromApiRequest(baseUrl, endpointIndex, queryString);
            } else {
                throw new Error("Got errors: " + JSON.stringify(errors));
            }
        }

        return data;
    }
}
