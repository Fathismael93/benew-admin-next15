import { NextResponse } from 'next/server';
import client from '@/utils/dbConnect';
import { deletePresentationSchema } from '@/utils/schemas';

export const dynamic = 'force-dynamic';

export async function DELETE({ params }) {
  console.log(await params);
  try {
    const { id } = await params;
    console.log(id);

    try {
      await deletePresentationSchema.validate({ id });

      const query = {
        // give the query a unique name
        name: 'delete-presentation',
        text: 'DELETE FROM presentations WHERE presentation_id=$1',
        values: [id],
      };

      client
        .query(query)
        .then(() => console.log('Presentation deleted with success'))
        .catch((e) => console.log(e));

      return NextResponse.json(
        {
          success: true,
          message: 'Presentation deleted successfully',
        },
        { status: 200 },
      );
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          message: error.inner[0].message,
        },
        { status: 400 },
      );
    }
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        message: 'Error in server',
      },
      { status: 500 },
    );
  }
}
