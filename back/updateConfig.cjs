const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function updateConfig() {
  await prisma.systemConfig.upsert({
    where: { id: 'default' },
    update: { primaryColor: '#0066ff', secondaryColor: '#ff9900', theme: 'dark' },
    create: { 
      id: 'default', 
      primaryColor: '#0066ff', 
      secondaryColor: '#ff9900', 
      theme: 'dark', 
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif' 
    }
  });
  console.log('Config updated');
}

updateConfig().finally(() => prisma.$disconnect());
