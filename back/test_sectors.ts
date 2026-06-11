import { config } from 'dotenv';
config();
import { prisma } from './src/lib/db';

async function run() {
  await prisma.client.updateMany({
    where: { sector: 'Educaci??n' },
    data: { sector: 'Educación' }
  });
  
  await prisma.client.updateMany({
    where: { name: 'Centro est??tico Caress' },
    data: { name: 'Centro estético Caress' }
  });

  console.log(`Fixed clients.`);
  await prisma.$disconnect();
}
run();
