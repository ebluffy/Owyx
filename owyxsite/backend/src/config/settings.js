// Настройки сервера
// Автоматически сгенерировано админ-панелью

module.exports = {
    "server": {
        "name": "Owyx",
        "description": "Owyx — сайт и лаунчер для Minecraft.",
        "ip": "owyx.site",
        "port": "25565",
        "website": "https://owyx.site",
        "discord": "https://discord.gg/your-invite",
        "telegram": "https://t.me/owyx"
    },
    "applications": {
        "minMotivationLength": 50,
        "minPlansLength": 30,
        "maxApplicationsPerDay": 3,
        "autoApprovalEnabled": false
    },
    "security": {
        "maxLoginAttempts": 5,
        "lockoutTime": 15,
        "tokenExpiration": "7d",
        "bcryptRounds": 12
    },
    "email": {
        "from": "noreply@owyx.site",
        "service": "gmail",
        "verificationExpiration": 24
    }
};
