import { NextResponse } from 'next/server';
import client from '../../../../../utils/dbConnect';
import { presentationSchema } from '../../../../../utils/schemas';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const formData = await req.json();

    const { name, title, text } = formData;

    try {
      await presentationSchema.validate(
        {
          name,
          title,
          text,
        },
        { abortEarly: false },
      );

      const query = {
        // give the query a unique name
        name: 'insert-presentation',
        text: 'INSERT INTO presentations (presentation_name, presentation_title, presentation_text) VALUES ($1, $2, $3) RETURNING *',
        values: [name, title, text],
      };

      const addingResult = await client.query(query);

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
          message: 'Data saved successfully',
          data: addingResult.rows[0],
        },
        { status: 201 },
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
