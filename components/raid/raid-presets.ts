import type { DungeonPreset, NovelType, RaidTheme } from "./raid-types";

// ── 番茄小说热门类型预设 ──────────────────────────────────
// 每个预设包含世界观模板（填空式），推荐画风，初始好感范围。

export const DUNGEON_PRESETS: DungeonPreset[] = [
    {
        id: "preset_rebirth",
        novelType: "rebirth",
        name: "凤凰涅槃·重生归来",
        worldviewTemplate:
            "前世你被挚爱背叛，眼睁睁看着家族覆灭。带着记忆重生回到一切开始之前，这一世你要让所有负你之人付出代价。你的目标是在______（背景：如豪门/京城/江湖）中重新崛起，而那个前世伤你最深的男人/女人，这一次你决定先下手为强——却发现事情并不像前世那样简单……",
        themes: ["modern", "ancient", "mono"],
        description: "重生复仇线，适合喜欢爽文逆袭的玩家。男主可能是前世仇人，也可能是前世被忽略的深情配角。",
        initialFavorRange: [15, 30],
        tags: ["重生", "复仇", "逆袭", "虐恋"],
    },
    {
        id: "preset_system",
        novelType: "system",
        name: "攻略系统·好感度面板",
        worldviewTemplate:
            "你绑定了一个攻略系统，系统发布了主线任务：在______（世界观背景）中攻略______（目标角色身份）。系统会实时显示好感度数值，但好感度归零=任务失败=抹杀。系统还发布了支线任务，每个任务都有时限，而你的竞争对手——另一个绑定系统的攻略者也在行动……",
        themes: ["cyber", "modern", "cozy"],
        description: "系统流攻略，好感度可视化，有任务时限和竞争对手压力。",
        initialFavorRange: [10, 25],
        tags: ["系统", "攻略", "时限", "竞争"],
    },
    {
        id: "preset_transmigration",
        novelType: "transmigration",
        name: "异世穿行·书穿任务",
        worldviewTemplate:
            "你穿进了自己看过的小说《______》，变成了书中最惨的女配/男配。原书中这个角色结局凄惨，而你要在原著剧情的框架下逆天改命。问题是原著的主角团对你的存在越来越警惕，而你发现原著作者似乎漏写了很多关键剧情……",
        themes: ["ancient", "modern", "horror"],
        description: "穿越进小说改变命运，需要应对原著剧情惯性，有元叙事趣味。",
        initialFavorRange: [5, 20],
        tags: ["穿越", "书穿", "改命", "原著剧情"],
    },
    {
        id: "preset_sweet",
        novelType: "sweet",
        name: "甜宠日常·追妻火葬",
        worldviewTemplate:
            "你是______（身份：如豪门继承人/霸道总裁/校园风云人物）的______（关系：如隐婚妻子/契约恋人/青梅竹马），对方曾经对你冷淡至极。然而某件事之后，对方突然开始疯狂倒追你，你却已经决定放手。在______（场景：如公司/校园/上流宴会）的日常中，甜蜜与心酸交织……",
        themes: ["modern", "cozy", "ancient"],
        description: "甜虐交织的恋爱日常，追妻火葬场经典套路，适合沉浸式恋爱体验。",
        initialFavorRange: [25, 40],
        tags: ["甜宠", "追妻", "日常", "虐中带甜"],
    },
    {
        id: "preset_abuse",
        novelType: "abuse",
        name: "虐恋情深·白月光与朱砂痣",
        worldviewTemplate:
            "你和男主之间隔着______（隔阂：如误会/家族仇恨/替身情结），你是他心头的朱砂痣，却是他口中不配拥有的人。当真相揭开时，一切已物是人非。在______（背景）中，你们的感情在伤害与救赎之间反复撕扯，而男二的出现让局面更加复杂……",
        themes: ["ancient", "mono", "modern"],
        description: "经典虐文，误会与反转交织，情绪浓度极高。需谨慎选择，一步错步步错。",
        initialFavorRange: [10, 20],
        tags: ["虐恋", "误会", "替身", "救赎"],
    },
    {
        id: "preset_harem",
        novelType: "harem",
        name: "后宫争斗·凤位之争",
        worldviewTemplate:
            "你入宫为______（位份：如答应/嫔/贵人），面对的是表面温良实则心机深沉的皇后与各路妃嫔。你的目标不仅是活下去，更是______（目标：如为家族复仇/登上后位/保护某人）。然而那个看似无情的帝王，似乎对你有着不为人知的执念……",
        themes: ["ancient", "palace" as RaidTheme, "horror"],
        description: "宫斗后宫文，权谋与爱情并行，每一个选择都可能万劫不复。",
        initialFavorRange: [5, 15],
        tags: ["宫斗", "权谋", "后宫", "心机"],
    },
    {
        id: "preset_undercover",
        novelType: "undercover",
        name: "潜伏者·身份迷局",
        worldviewTemplate:
            "你的真实身份是______（身份：如卧底警察/间谍/叛军内应），潜伏在______（组织）内部。你的目标人物是这个组织的核心人物。你必须在完成任务和不被发现之间走钢丝，而当你对目标产生感情时，忠诚与心动成了最致命的矛盾……",
        themes: ["modern", "cyber", "mono"],
        description: "谍战潜伏文，身份随时可能暴露，感情与任务冲突。",
        initialFavorRange: [10, 20],
        tags: ["谍战", "潜伏", "身份", "背叛"],
    },
    {
        id: "preset_apocalypse",
        novelType: "apocalypse",
        name: "末世求生·异能觉醒",
        worldviewTemplate:
            "末日降临，世界沦为______（灾难类型：如丧尸/异变/极寒）的炼狱。你在废墟中觉醒了______（异能），遇到了一群幸存者。在这个规则崩塌的世界里，人性比怪物更可怕。你要攻略的目标是幸存者营地的首领，而他的信任比任何物资都难获得……",
        themes: ["horror", "cyber", "mono"],
        description: "末世生存文，资源匮乏与人心叵测双重压力，攻略难度极高。",
        initialFavorRange: [5, 15],
        tags: ["末世", "求生", "异能", "人性"],
    },
    {
        id: "preset_campus",
        novelType: "campus",
        name: "校园青春·暗恋回响",
        worldviewTemplate:
            "你是______（学校名）的转学生/普通学生，阴差阳错和全校闻名的______（男主身份：如校草/学霸/问题少年）产生交集。从互相看不顺眼到渐生情愫，校园的日常里藏着最纯粹的心动。然而男二的介入和校园霸凌事件让一切变得复杂……",
        themes: ["modern", "cozy", "mono"],
        description: "校园文，纯爱日常，但暗流涌动。适合喜欢治愈向但又有剧情张力的玩家。",
        initialFavorRange: [20, 35],
        tags: ["校园", "暗恋", "青春", "治愈"],
    },
    {
        id: "preset_business",
        novelType: "business",
        name: "商战豪门·棋逢对手",
        worldviewTemplate:
            "你是______集团（公司名）的______（身份：如继承人/特助/商业间谍），在一场惊天并购案中与对手公司的核心人物狭路相逢。商场如战场，你们既是商业对手又在感情上互相吸引。而你的家族秘密让这场博弈变得更加危险……",
        themes: ["modern", "mono", "cyber"],
        description: "商战文，智商博弈+感情拉扯，适合喜欢强强对决的玩家。",
        initialFavorRange: [10, 25],
        tags: ["商战", "豪门", "博弈", "强强"],
    },
    {
        id: "preset_immortal",
        novelType: "immortal",
        name: "仙途漫漫·道心问情",
        worldviewTemplate:
            "你拜入______宗门（宗门名）修仙，身负______（特殊体质/天赋/宿命）。在求道之路上，你遇到了______（男主身份：如宗门师叔/魔道魔尊/同门师兄）。修仙界正邪对立，而你们的感情在道心与执念之间反复拉扯。渡劫将至，你该如何抉择？",
        themes: ["ancient", "horror", "mono"],
        description: "仙侠修真文，世界观宏大，正邪对立与儿女情长交织。",
        initialFavorRange: [10, 20],
        tags: ["仙侠", "修真", "正邪", "渡劫"],
    },
    {
        id: "preset_palace",
        novelType: "palace",
        name: "权谋天下·帝王心术",
        worldviewTemplate:
            "你是______（身份：如和亲公主/将门之女/前朝遗孤），被迫卷入夺嫡之争。表面上你是棋子，暗地里你也在布局。那个坐在龙椅上的男人，对你时而冷酷时而深情。在这场权力的游戏中，一步踏错便是万劫不复……",
        themes: ["ancient", "mono", "horror"],
        description: "权谋宫廷文，政治博弈与爱情平衡，每一个选择都可能改变天下格局。",
        initialFavorRange: [5, 15],
        tags: ["权谋", "夺嫡", "宫斗", "帝王"],
    },
];

// 按类型查找预设
export function getPresetByNovelType(type: NovelType): DungeonPreset | undefined {
    return DUNGEON_PRESETS.find((p) => p.novelType === type);
}

// 随机选一个预设
export function getRandomPreset(): DungeonPreset {
    return DUNGEON_PRESETS[Math.floor(Math.random() * DUNGEON_PRESETS.length)];
}

// 从世界观模板里提取填空项（______）
export function extractBlanks(template: string): string[] {
    const matches = template.match(/_{2,}/g);
    return matches || [];
}

// 把填好的值填回模板
export function fillTemplate(template: string, values: string[]): string {
    let result = template;
    let idx = 0;
    result = result.replace(/_{2,}/g, () => {
        const v = values[idx++];
        return v ? `【${v}】` : "______";
    });
    return result;
}
