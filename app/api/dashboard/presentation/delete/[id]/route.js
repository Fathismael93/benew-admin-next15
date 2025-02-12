import { NextResponse } from 'next/server';
import client from '@/utils/dbConnect';
import { deletePresentationSchema } from '@/utils/schemas';

export const dynamic = 'force-dynamic';

export async function DELETE(params) {
  console.log(params);
  try {
    const { id } = params;

    try {
      await deletePresentationSchema.validate({ id });

      const query = {
        // give the query a unique name
        name: 'delete-presentation',
        text: 'DELETE FROM presentations WHERE presentation_id=$1',
        values: [id],
      };

      client.connect(function (err) {
        if (err) {
          console.log(err);
          throw err;
        }

        console.log('Connected To Aiven, Postgresql Database');
      });

      client
        .query(query)
        .then(() => console.log('Presentation deleted with success'))
        .catch((e) => console.log(e));

      client.end(function (err) {
        if (err) {
          console.log(err);
          throw err;
        }

        console.log('Client Connected To Aiven Postgresql Database is stopped');
      });

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
